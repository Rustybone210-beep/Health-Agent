// ============================================================
// share-with-doctor.js — Secure temporary share links for doctors
//
// Generates a beautiful, self-contained HTML page with the
// patient's full medical summary. Doctor opens the link,
// sees everything, no login required. Expires in 72 hours.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LINKS_FILE = path.join(__dirname, '..', 'data', 'share_links.json');

function loadLinks() {
  try {
    if (!fs.existsSync(LINKS_FILE)) return [];
    return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  } catch (e) { return []; }
}

function saveLinks(links) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2));
  try { require('./cloud-storage').syncAfterWrite('share_links.json'); } catch(e) {}
}

function createShareLink(patientId, options = {}) {
  const token = crypto.randomBytes(20).toString('hex');
  const expiresHours = options.expiresHours || 72;
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString();

  const links = loadLinks();
  links.push({
    token,
    patientId,
    createdAt: new Date().toISOString(),
    expiresAt,
    accessCount: 0,
    active: true,
    createdBy: options.userId || 'unknown',
    note: options.note || null,
  });
  saveLinks(links);

  return { token, expiresAt };
}

function getShareLink(token) {
  const links = loadLinks();
  const link = links.find(l => l.token === token && l.active);
  if (!link) return null;
  if (new Date(link.expiresAt) < new Date()) {
    link.active = false;
    saveLinks(links);
    return null;
  }
  // Increment access count
  link.accessCount++;
  link.lastAccessedAt = new Date().toISOString();
  saveLinks(links);
  return link;
}

function listActiveLinks(patientId) {
  const links = loadLinks();
  const now = new Date();
  return links.filter(l => l.patientId === patientId && l.active && new Date(l.expiresAt) > now);
}

function revokeLink(token) {
  const links = loadLinks();
  const link = links.find(l => l.token === token);
  if (!link) return false;
  link.active = false;
  saveLinks(links);
  return true;
}

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function buildSharedPage(patient, link) {
  const p = patient || {};
  const age = p.dob ? Math.floor((Date.now() - new Date(p.dob).getTime()) / 31557600000) : '';
  const expiresDate = new Date(link.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const meds = (p.medications || []).map(m =>
    `<div class="med-row"><div class="med-name">${esc(m.name)}</div><div class="med-detail">${esc(m.dose || '')} ${esc(m.frequency || '')}</div></div>`
  ).join('') || '<div class="none">No medications on file</div>';

  const conditions = (p.conditions || []).map(c =>
    `<span class="pill p-teal">${esc(c)}</span>`
  ).join('') || '<span class="none">None on file</span>';

  const allergies = (p.allergies || []).map(a =>
    `<span class="pill p-red">${esc(a)}</span>`
  ).join('') || '<span class="none">None known</span>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Patient Summary — ${esc(p.name || 'Patient')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,sans-serif;background:linear-gradient(165deg,#0a0f1a 0%,#0f172a 50%,#0a0f1a 100%);color:#f1f5f9;min-height:100vh;padding:20px;-webkit-font-smoothing:antialiased}
.container{max-width:640px;margin:0 auto}
.header{text-align:center;padding:24px 0 20px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:24px}
.header-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:100px;background:rgba(20,184,166,0.1);border:1px solid rgba(20,184,166,0.15);font-size:11px;font-weight:600;color:#14b8a6;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px}
.header h1{font-size:28px;font-weight:800;letter-spacing:-1px;margin-bottom:4px}
.header h1 span{color:#2dd4bf}
.header p{font-size:13px;color:#475569}
.patient-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:24px;margin-bottom:16px}
.patient-name{font-size:24px;font-weight:800;margin-bottom:4px}
.patient-sub{font-size:14px;color:#94a3b8}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
.info-item{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:12px}
.info-item.full{grid-column:1/-1}
.info-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:4px}
.info-value{font-size:14px;font-weight:500;color:#f1f5f9}
.section{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:20px;margin-bottom:16px}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#14b8a6;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.section-title i{font-size:13px}
.pill{display:inline-block;padding:5px 14px;border-radius:100px;font-size:12px;font-weight:600;margin:3px}
.p-teal{background:rgba(20,184,166,0.1);color:#2dd4bf;border:1px solid rgba(20,184,166,0.15)}
.p-red{background:rgba(239,68,68,0.08);color:#fca5a5;border:1px solid rgba(239,68,68,0.12)}
.med-row{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:12px;margin-bottom:8px}
.med-name{font-size:14px;font-weight:600;color:#f1f5f9}
.med-detail{font-size:12px;color:#94a3b8;margin-top:2px}
.none{font-size:13px;color:#475569;font-style:italic}
.actions{display:flex;gap:10px;margin-top:20px}
.btn{flex:1;padding:14px;border-radius:100px;font-size:14px;font-weight:700;cursor:pointer;border:none;text-align:center;transition:all 0.2s}
.btn-print{background:rgba(255,255,255,0.06);color:#94a3b8;border:1px solid rgba(255,255,255,0.08)}
.btn-print:hover{background:rgba(255,255,255,0.1);color:#f1f5f9}
.footer{text-align:center;padding:24px 0;font-size:11px;color:#334155;border-top:1px solid rgba(255,255,255,0.04);margin-top:24px}
.footer a{color:#14b8a6;text-decoration:none}
.expire-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:100px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.12);font-size:11px;color:#fbbf24;margin-top:8px}
@media print{
  body{background:#fff;color:#000;padding:10px}
  .header-badge,.actions,.footer{display:none}
  .patient-card,.section,.info-item,.med-row{background:#f8f8f8;border-color:#ddd}
  .patient-name,.med-name,.info-value{color:#000}
  .patient-sub,.med-detail,.info-label{color:#666}
  .pill{border-color:#ccc}
  .p-teal{background:#e6f7f5;color:#0d6b5e}
  .p-red{background:#fde8e8;color:#b91c1c}
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="header-badge"><i class="fa-solid fa-shield-halved"></i> Secure Patient Summary</div>
    <h1><span>Health</span>Agent</h1>
    <p>Shared by caregiver for clinical reference</p>
  </div>

  <div class="patient-card">
    <div class="patient-name">${esc(p.name || 'Patient')}</div>
    <div class="patient-sub">${age ? age + ' years old' : ''} ${p.relationship ? ' &middot; ' + esc(p.relationship) : ''}</div>
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Date of Birth</div><div class="info-value">${esc(p.dob || 'Unknown')}</div></div>
      <div class="info-item"><div class="info-label">Phone</div><div class="info-value">${esc(p.phone || 'On file')}</div></div>
      <div class="info-item"><div class="info-label">Primary Doctor</div><div class="info-value">${esc(p.primaryDoctor || 'Unknown')}${p.clinic ? ' &middot; ' + esc(p.clinic) : ''}</div></div>
      <div class="info-item"><div class="info-label">Pharmacy</div><div class="info-value">${esc(p.pharmacy?.name || 'Unknown')} ${esc(p.pharmacy?.phone || '')}</div></div>
      <div class="info-item full"><div class="info-label">Insurance</div><div class="info-value">${esc(p.insurance?.primary || 'Unknown')}${p.insurance?.secondary ? ' + ' + esc(p.insurance.secondary) : ''}<br>Member ID: ${esc(p.insurance?.memberId || 'On file')}</div></div>
      <div class="info-item full"><div class="info-label">Address</div><div class="info-value">${esc(p.address || 'On file')}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title"><i class="fa-solid fa-triangle-exclamation"></i> Allergies</div>
    <div>${allergies}</div>
  </div>

  <div class="section">
    <div class="section-title"><i class="fa-solid fa-heart-pulse"></i> Conditions</div>
    <div>${conditions}</div>
  </div>

  <div class="section">
    <div class="section-title"><i class="fa-solid fa-pills"></i> Current Medications</div>
    ${meds}
  </div>

  <div class="actions">
    <button class="btn btn-print" onclick="window.print()"><i class="fa-solid fa-print" style="margin-right:6px"></i>Print</button>
  </div>

  <div class="footer">
    <div class="expire-badge"><i class="fa-solid fa-clock"></i> This link expires ${expiresDate}</div>
    <p style="margin-top:12px">Generated by <a href="https://healthagentcare.com">Health Agent</a></p>
    <p>This summary is shared for clinical reference only. Verify all information with the patient.</p>
  </div>
</div>
</body>
</html>`;
}

module.exports = { createShareLink, getShareLink, listActiveLinks, revokeLink, buildSharedPage };
