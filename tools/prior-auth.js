const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname,'../data/prior_auths.json');

function load() {
  try { if(!fs.existsSync(DATA_FILE)) return []; return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch(e) { return []; }
}
function save(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d,null,2)); }

const COMMON_PA_REASONS = {
  'step_therapy': 'Insurance requires trying cheaper medications first (step therapy). Appeal by documenting failed trials.',
  'not_medically_necessary': 'Insurance claims the treatment isn\'t needed. Appeal requires clinical evidence of necessity.',
  'experimental': 'Insurance claims treatment is experimental. Appeal with peer-reviewed studies and specialist letters.',
  'formulary': 'Drug not on insurance formulary. Appeal for formulary exception based on medical necessity.',
  'quantity_limit': 'Insurance limits quantity. Appeal with documentation of why standard quantity is insufficient.',
  'off_label': 'Drug used for unapproved indication. Appeal with clinical evidence for the specific use.'
};

function generatePARequest(patient, medication, diagnosis, clinicalJustification, prescriber) {
  const p = patient || {};
  const today = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const conditions = (p.conditions||[]).join('; ');
  const meds = (p.medications||[]).map(m=>m.name+' '+( m.dose||'')).join(', ');
  const allergies = (p.allergies||[]).join(', ');

  const letter = `PRIOR AUTHORIZATION REQUEST
Date: ${today}
Patient: ${p.name||'Unknown'} | DOB: ${p.dob||'Unknown'}
Member ID: ${p.insurance?.memberId||'On file'}
Insurance: ${p.insurance?.primary||'Unknown'} ${p.insurance?.secondary?'+ '+p.insurance.secondary:''}
Prescriber: ${prescriber||p.primaryDoctor||'Unknown'}

RE: Prior Authorization Request for ${medication}

To Whom It May Concern,

I am writing to request prior authorization for ${medication} for my patient, ${p.name||'the patient above'}.

DIAGNOSIS: ${diagnosis}

CLINICAL JUSTIFICATION:
${clinicalJustification||'[Clinical justification to be provided by prescriber]'}

PATIENT MEDICAL HISTORY:
Active Conditions: ${conditions||'See attached records'}
Current Medications: ${meds||'See attached medication list'}
Known Allergies: ${allergies||'NKDA'}

MEDICAL NECESSITY:
This medication is medically necessary because:
1. The patient has been diagnosed with ${diagnosis} as documented in the medical record
2. Alternative treatments have been considered and are inappropriate for this patient due to their specific medical conditions
3. Without this medication, the patient's condition is likely to deteriorate, resulting in higher healthcare costs

REQUESTED AUTHORIZATION:
Medication: ${medication}
Duration: 12 months (annual renewal)

Please process this request within the required timeframe. If additional clinical information is needed, please contact the prescribing physician directly.

If this request is denied, please provide:
1. The specific clinical criteria used in the determination
2. Information on the appeals process
3. The name of the reviewing physician

Sincerely,
${prescriber||p.primaryDoctor||'Prescribing Physician'}

---
⚕️ This prior authorization request was generated with Health Agent. All clinical decisions are made by the treating physician.`;

  const paRecord = {
    id: Date.now().toString(),
    patientId: p.id,
    medication,
    diagnosis,
    status: 'submitted',
    generatedAt: new Date().toISOString(),
    letterText: letter
  };

  const records = load();
  records.unshift(paRecord);
  save(records);

  return { letter, record: paRecord };
}

function getPAHistory(patientId) {
  return load().filter(r => r.patientId === patientId);
}

module.exports = { generatePARequest, getPAHistory, COMMON_PA_REASONS };
