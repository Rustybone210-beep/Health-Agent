#!/usr/bin/env node
// fix_scan_card.js — Run from ~/HealthAgent to fix the scan card rendering
// Usage: node fix_scan_card.js

const fs = require('fs');
const path = './public/index.html';

if (!fs.existsSync(path)) {
  console.error('❌ public/index.html not found. Run from ~/HealthAgent');
  process.exit(1);
}

let html = fs.readFileSync(path, 'utf8');

// Fix 1: Replace the renderScanCard function with a smarter version
const oldRenderScanCard = `function renderScanCard(data, fileName = 'Scanned item'){
  latestScanData = { ...data, fileName, patientId: currentPatientId };

  const confidence = inferConfidence(data);

  const html = \`
    <div class="msg ai">
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble">
        <div class="scan-card">
          <div class="scan-header">
            <div class="scan-icon">📷</div>
            <div class="scan-title">Scan Result</div>
            <div class="scan-badges">
              <span class="scan-badge \${confidence.className}">\${esc(confidence.label)}</span>
              <span class="scan-badge info">review before save</span>
            </div>
          </div>

          <p>I extracted structured details from <strong>\${esc(fileName)}</strong>. Review this before saving to the chart.</p>

          <div class="scan-grid">
            <div class="scan-field">
              <span class="scan-label">Type</span>
              <span class="scan-value">\${esc(data.document_type || 'Unknown')}</span>
            </div>

            <div class="scan-field">
              <span class="scan-label">Brand</span>
              <span class="scan-value">\${esc(data.brand || 'Unknown')}</span>
            </div>

            <div class="scan-field">
              <span class="scan-label">Product</span>
              <span class="scan-value">\${esc(data.product_name || 'Unknown')}</span>
            </div>

            <div class="scan-field">
              <span class="scan-label">Form</span>
              <span class="scan-value">\${esc(data.form || 'Unknown')}</span>
            </div>

            <div class="scan-field full">
              <span class="scan-label">Purpose</span>
              <span class="scan-value">\${esc(data.purpose || 'No purpose extracted')}</span>
            </div>

            <div class="scan-field full">
              <span class="scan-label">Description</span>
              <span class="scan-value">\${esc(data.description || 'No description extracted')}</span>
            </div>

            <div class="scan-field full">
              <span class="scan-label">Patient Context</span>
              <span class="scan-value">\${esc(data.patient_context || 'No patient context yet')}</span>
            </div>
          </div>

          <div class="scan-actions">
            <button class="scan-btn primary" onclick="confirmScan()">Save to Chart</button>
            <button class="scan-btn" onclick="checkInteractions()">Check Interactions</button>
            <button class="scan-btn" onclick="askDoctor()">Ask Doctor</button>
          </div>

          <div class="scan-foot">This is scan-assisted extraction, not guaranteed truth. Confirm before treating it as medical record data.</div>
        </div>
      </div>
    </div>
  \`;

  ['chatArea','chatAreaDesktop'].forEach(areaId => {
    const area = document.getElementById(areaId);
    if (area) {
      area.insertAdjacentHTML('beforeend', html);
      area.scrollTop = area.scrollHeight;
    }
  });

  setMobileState('chat');
}`;

const newRenderScanCard = `function renderScanCard(data, fileName = 'Scanned item'){
  latestScanData = { ...data, fileName, patientId: currentPatientId };

  const docType = String(data.document_type || '').toLowerCase();
  const conf = data.confidence || 'low';
  const confClass = conf === 'high' ? 'safe' : conf === 'medium' ? 'warn' : 'info';

  function buildFields(d) {
    const fields = [];
    const add = (label, value) => {
      if (value && value !== 'Unknown' && value !== 'unclear' && value !== 'N/A') {
        fields.push({ label, value: String(value), full: false });
      }
    };
    const addFull = (label, value) => {
      if (value && value !== 'Unknown' && value !== 'unclear' && value !== 'N/A') {
        fields.push({ label, value: String(value), full: true });
      }
    };

    add('Document Type', d.document_type);

    if (docType === 'insurance_card') {
      add('Insurance Co.', d.insurance_company);
      add('Plan Name', d.plan_name);
      add('Member Name', d.member_name);
      add('Member ID', d.member_id);
      add('Group Number', d.group_number);
      add('RX BIN', d.rx_bin);
      add('RX PCN', d.rx_pcn);
      add('RX Group', d.rx_group);
      add('Effective Date', d.effective_date);
      addFull('Copays', typeof d.copay_amounts === 'object' ? JSON.stringify(d.copay_amounts) : d.copay_amounts);
      addFull('Phone Numbers', typeof d.phone_numbers === 'object' ? JSON.stringify(d.phone_numbers) : d.phone_numbers);
    } else if (docType === 'prescription') {
      add('Medication', d.medication_name);
      add('Dosage', d.dosage);
      add('Frequency', d.frequency);
      add('Quantity', d.quantity);
      add('Refills Left', d.refills_remaining);
      add('Prescriber', d.prescriber);
      add('Pharmacy', d.pharmacy_name);
      add('Pharmacy Phone', d.pharmacy_phone);
      add('RX Number', d.rx_number);
      add('Date Filled', d.date_filled);
      add('Expires', d.expiration_date);
      addFull('Warnings', d.warnings);
    } else if (docType === 'lab_result') {
      add('Lab Name', d.lab_name);
      add('Date of Test', d.date_of_test);
      add('Ordering Doctor', d.ordering_doctor);
      add('Patient Name', d.patient_name);
      addFull('Tests', typeof d.test_names === 'object' ? JSON.stringify(d.test_names) : d.test_names);
      addFull('Values', typeof d.values === 'object' ? JSON.stringify(d.values) : d.values);
      addFull('Abnormal Flags', typeof d.abnormal_flags === 'object' ? JSON.stringify(d.abnormal_flags) : d.abnormal_flags);
    } else if (docType === 'medical_bill') {
      add('Provider', d.provider_name);
      add('Date of Service', d.date_of_service);
      add('Total Charge', d.total_charge);
      add('Insurance Paid', d.insurance_paid);
      add('You Owe', d.patient_responsibility);
      add('Claim Number', d.claim_number);
      addFull('Procedure Codes', typeof d.procedure_codes === 'object' ? JSON.stringify(d.procedure_codes) : d.procedure_codes);
    } else if (docType === 'referral') {
      add('Referring Doctor', d.referring_doctor);
      add('Specialist', d.specialist);
      add('Auth Number', d.authorization_number);
      add('Valid Dates', d.valid_dates);
      add('Approved Visits', d.approved_visits);
    } else {
      // Generic fallback — show whatever we got
      add('Brand', d.brand);
      add('Product', d.product_name);
      add('Form', d.form);
      addFull('Purpose', d.purpose);
      addFull('Description', d.description);
    }

    addFull('Summary', d.summary);
    return fields;
  }

  const fields = buildFields(data);
  const fieldsHtml = fields.map(f =>
    \`<div class="scan-field\${f.full ? ' full' : ''}"><span class="scan-label">\${esc(f.label)}</span><span class="scan-value">\${esc(f.value)}</span></div>\`
  ).join('');

  const typeLabels = {
    insurance_card: '🪪 Insurance Card',
    prescription: '💊 Prescription',
    lab_result: '🧪 Lab Result',
    medical_bill: '💰 Medical Bill',
    referral: '📄 Referral',
    other: '📋 Document'
  };
  const typeLabel = typeLabels[docType] || '📋 Document';

  const cardHtml = \`
    <div class="msg ai">
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble">
        <div class="scan-card">
          <div class="scan-header">
            <div class="scan-icon">📷</div>
            <div class="scan-title">\${typeLabel}</div>
            <div class="scan-badges">
              <span class="scan-badge \${confClass}">\${esc(conf)} confidence</span>
              <span class="scan-badge info">review before save</span>
            </div>
          </div>

          <p>Scanned <strong>\${esc(fileName)}</strong>. Review before saving.</p>

          <div class="scan-grid">\${fieldsHtml}</div>

          <div class="scan-actions">
            <button class="scan-btn primary" onclick="confirmScan()">Save to Chart</button>
            <button class="scan-btn" onclick="checkInteractions()">Check Interactions</button>
            <button class="scan-btn" onclick="askDoctor()">Ask Doctor</button>
          </div>

          <div class="scan-foot">AI-assisted extraction. Verify before treating as medical record.</div>
        </div>
      </div>
    </div>
  \`;

  ['chatArea','chatAreaDesktop'].forEach(areaId => {
    const area = document.getElementById(areaId);
    if (area) {
      area.insertAdjacentHTML('beforeend', cardHtml);
      area.scrollTop = area.scrollHeight;
    }
  });

  setMobileState('chat');
}`;

// Also fix the inferConfidence function to work with new fields
const oldInferConfidence = `function inferConfidence(data){
  let score = 0;
  if (data.product_name) score += 35;
  if (data.brand) score += 20;
  if (data.document_type) score += 15;
  if (data.purpose) score += 15;
  if (data.form) score += 10;
  if (data.description) score += 5;
  if (score >= 75) return {label:'high confidence', className:'safe'};
  if (score >= 45) return {label:'review advised', className:'warn'};
  return {label:'low confidence', className:'info'};
}`;

const newInferConfidence = `function inferConfidence(data){
  // Use server-provided confidence if available
  if (data.confidence === 'high') return {label:'high confidence', className:'safe'};
  if (data.confidence === 'medium') return {label:'review advised', className:'warn'};
  if (data.confidence === 'low') return {label:'low confidence', className:'info'};
  // Fallback scoring
  let score = 0;
  if (data.document_type) score += 20;
  if (data.summary) score += 20;
  if (data.member_id || data.medication_name || data.test_names) score += 25;
  if (data.insurance_company || data.prescriber || data.lab_name) score += 15;
  if (data.confidence) score += 10;
  const keys = Object.keys(data).filter(k => data[k] && data[k] !== 'Unknown' && data[k] !== 'unclear');
  score += Math.min(keys.length * 3, 30);
  if (score >= 60) return {label:'high confidence', className:'safe'};
  if (score >= 35) return {label:'review advised', className:'warn'};
  return {label:'low confidence', className:'info'};
}`;

// Apply patches
let patched = false;

if (html.includes('function renderScanCard(data, fileName')) {
  // Find and replace the renderScanCard function
  const startMarker = 'function renderScanCard(data, fileName';
  const startIdx = html.indexOf(startMarker);
  
  if (startIdx !== -1) {
    // Find the end of the function by counting braces
    let braceCount = 0;
    let inFunction = false;
    let endIdx = startIdx;
    
    for (let i = startIdx; i < html.length; i++) {
      if (html[i] === '{') {
        braceCount++;
        inFunction = true;
      }
      if (html[i] === '}') {
        braceCount--;
        if (inFunction && braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    
    html = html.substring(0, startIdx) + newRenderScanCard + html.substring(endIdx);
    console.log('✅ renderScanCard replaced with smart document-type detection');
    patched = true;
  }
}

if (html.includes('function inferConfidence(data)')) {
  const startMarker = 'function inferConfidence(data)';
  const startIdx = html.indexOf(startMarker);
  
  if (startIdx !== -1) {
    let braceCount = 0;
    let inFunction = false;
    let endIdx = startIdx;
    
    for (let i = startIdx; i < html.length; i++) {
      if (html[i] === '{') {
        braceCount++;
        inFunction = true;
      }
      if (html[i] === '}') {
        braceCount--;
        if (inFunction && braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    
    html = html.substring(0, startIdx) + newInferConfidence + html.substring(endIdx);
    console.log('✅ inferConfidence updated for new data format');
    patched = true;
  }
}

if (patched) {
  fs.writeFileSync(path, html);
  console.log('✅ public/index.html saved');
} else {
  console.log('❌ Could not find functions to patch');
}

// Now fix server.js safeWriteJson typo
const serverPath = './server.js';
if (fs.existsSync(serverPath)) {
  let server = fs.readFileSync(serverPath, 'utf8');
  if (server.includes('        safe\nWriteJson(TIMELINE_FILE, timelineData);')) {
    server = server.replace(
      '        safe\nWriteJson(TIMELINE_FILE, timelineData);',
      '        safeWriteJson(TIMELINE_FILE, timelineData);'
    );
    fs.writeFileSync(serverPath, server);
    console.log('✅ server.js safeWriteJson typo fixed');
  } else if (server.includes('safe\nWriteJson')) {
    server = server.replace(/safe\nWriteJson/g, 'safeWriteJson');
    fs.writeFileSync(serverPath, server);
    console.log('✅ server.js safeWriteJson typo fixed (alt pattern)');
  } else {
    console.log('ℹ️  server.js safeWriteJson typo not found — may already be fixed');
  }
} else {
  console.log('⚠️  server.js not found');
}

console.log('\n🏥 Done! Now run:');
console.log('   git add .');
console.log('   git commit -m "Fix scan card + server typo"');
console.log('   git push origin main');
