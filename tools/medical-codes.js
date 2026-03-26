// medical-codes.js — ICD-10, CPT, NDC, FDA drug lookups
const https = require('https');

// ── ICD-10 LOOKUP via NLM API (free, no key) ──
function searchICD10(query) {
  return new Promise((resolve, reject) => {
    const url = `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=${encodeURIComponent(query)}&maxList=10`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const total = data[0] || 0;
          const codes = (data[3] || []).map(item => ({
            code: item[0],
            description: item[1],
            plain_english: item[1]?.replace(/,?\s*unspecified/gi,'').trim()
          }));
          resolve({ total, codes, query });
        } catch(e) { reject(new Error('ICD-10 lookup error')); }
      });
    }).on('error', reject).setTimeout(6000, () => reject(new Error('ICD-10 timeout')));
  });
}

// ── FDA DRUG LOOKUP (free, no key) ──
function lookupDrug(drugName) {
  return new Promise((resolve, reject) => {
    const url = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(drugName)}"&limit=1`;
    https.get(url, { headers: { 'User-Agent': 'HealthAgent/1.0' } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const result = data.results?.[0];
          if(!result) return resolve(null);
          resolve({
            brandName: result.openfda?.brand_name?.[0] || drugName,
            genericName: result.openfda?.generic_name?.[0] || null,
            manufacturer: result.openfda?.manufacturer_name?.[0] || null,
            route: result.openfda?.route?.[0] || null,
            warnings: result.warnings?.[0]?.substring(0,500) || null,
            warningsAndPrecautions: result.warnings_and_cautions?.[0]?.substring(0,500) || null,
            adverseReactions: result.adverse_reactions?.[0]?.substring(0,300) || null,
            drugInteractions: result.drug_interactions?.[0]?.substring(0,300) || null,
            dosageAndAdmin: result.dosage_and_administration?.[0]?.substring(0,300) || null,
            contraindications: result.contraindications?.[0]?.substring(0,300) || null,
            pregnancyCategory: result.pregnancy?.[0]?.substring(0,100) || null,
            rxNormId: result.openfda?.rxcui?.[0] || null,
            ndcCode: result.openfda?.package_ndc?.[0] || null,
            blackBoxWarning: result.boxed_warning?.[0]?.substring(0,400) || null,
            hasBlackBox: !!(result.boxed_warning?.[0])
          });
        } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null)).setTimeout(6000, () => resolve(null));
  });
}

// ── FDA DRUG RECALL LOOKUP ──
function checkDrugRecalls(drugName) {
  return new Promise((resolve, reject) => {
    const url = `https://api.fda.gov/drug/enforcement.json?search=product_description:"${encodeURIComponent(drugName)}"&limit=5&sort=report_date:desc`;
    https.get(url, { headers: { 'User-Agent': 'HealthAgent/1.0' } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const recalls = (data.results || []).map(r => ({
            date: r.report_date,
            product: r.product_description,
            reason: r.reason_for_recall,
            classification: r.classification,
            status: r.status,
            recallingFirm: r.recalling_firm
          }));
          resolve({ hasRecalls: recalls.length > 0, recalls, drug: drugName });
        } catch(e) { resolve({ hasRecalls: false, recalls: [], drug: drugName }); }
      });
    }).on('error', () => resolve({ hasRecalls: false, recalls: [] })).setTimeout(6000, () => resolve({ hasRecalls: false, recalls: [] }));
  });
}

// ── PLAIN ENGLISH CODE EXPLAINER ──
const CPT_COMMON = {
  '99213': 'Office visit — established patient, moderate complexity (most common doctor visit)',
  '99214': 'Office visit — established patient, high complexity',
  '99203': 'Office visit — new patient, low-moderate complexity',
  '99204': 'Office visit — new patient, moderate complexity',
  '93000': 'EKG with interpretation',
  '85025': 'Complete blood count (CBC) with differential',
  '80053': 'Comprehensive metabolic panel (CMP) — blood chemistry',
  '82607': 'Vitamin B12 level',
  '84443': 'TSH (thyroid stimulating hormone)',
  '84439': 'Thyroxine (T4) free',
  '80061': 'Lipid panel (cholesterol, HDL, LDL, triglycerides)',
  '83036': 'Hemoglobin A1c (HbA1c) — diabetes control',
  '82947': 'Glucose blood test',
  '71046': 'Chest X-ray, 2 views',
  '73721': 'MRI knee',
  '70553': 'MRI brain with and without contrast',
  '72148': 'MRI lumbar spine without contrast',
  '77067': 'Mammogram, bilateral',
  '45378': 'Colonoscopy, diagnostic',
  '99395': 'Annual preventive visit, 18-39 years',
  '99396': 'Annual preventive visit, 40-64 years',
  '99397': 'Annual preventive visit, 65+ years',
  'G0438': 'Annual wellness visit, Medicare (first)',
  'G0439': 'Annual wellness visit, Medicare (subsequent)',
  '90658': 'Flu vaccine, age 3 and older',
  '90686': 'Flu vaccine, quadrivalent'
};

function explainCPT(code) {
  return CPT_COMMON[code] || `CPT ${code} — contact your insurer or provider for a plain English explanation`;
}

module.exports = { searchICD10, lookupDrug, checkDrugRecalls, explainCPT, CPT_COMMON };
