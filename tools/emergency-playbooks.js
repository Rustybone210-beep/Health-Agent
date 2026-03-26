const PLAYBOOKS = {
  stroke: {
    id: 'stroke',
    title: 'Stroke Emergency',
    icon: 'brain',
    color: '#ef4444',
    triggers: ['stroke','face drooping','arm weakness','speech difficulty','sudden numbness','FAST'],
    steps: [
      { step: 1, action: 'CALL 911 IMMEDIATELY', detail: 'Do not drive to hospital. Call 911. Time is brain — every minute matters.', urgent: true },
      { step: 2, action: 'Note the time', detail: 'Write down the exact time symptoms started. Doctors need this for tPA treatment eligibility (within 4.5 hours).', urgent: true },
      { step: 3, action: 'Use FAST test', detail: 'Face drooping? Arm weakness? Speech slurred? Time to call. If any yes — stroke protocol active.', urgent: true },
      { step: 4, action: 'Do NOT give food or water', detail: 'Stroke can affect swallowing. Risk of choking. Nothing by mouth until evaluated.', urgent: false },
      { step: 5, action: 'Stay calm, stay with patient', detail: 'Keep patient lying down, head slightly elevated. Loosen tight clothing. Do not leave them alone.', urgent: false },
      { step: 6, action: 'Tell paramedics', detail: 'Patient name, age, medications (especially blood thinners), allergies, insurance, last known normal time.', urgent: false },
      { step: 7, action: 'Notify primary doctor', detail: 'Call Dr. Martinez after emergency is stabilized. Request stroke neurology consult.', urgent: false }
    ],
    emergency_contacts: ['911', 'Stroke Helpline: 1-888-4-STROKE'],
    hospital_prep: 'Methodist Hospital has stroke certification. Tell ER "possible stroke" at check-in for immediate priority.'
  },
  fall: {
    id: 'fall',
    title: 'Fall Emergency',
    icon: 'person-falling',
    color: '#f59e0b',
    triggers: ['fell','fallen','fall','on the floor','cant get up'],
    steps: [
      { step: 1, action: 'Do NOT move them immediately', detail: 'If they hit their head or complain of neck/back pain — do not move. Call 911.', urgent: true },
      { step: 2, action: 'Assess consciousness', detail: 'Are they responsive? Talking? Confused? If unconscious — call 911 immediately.', urgent: true },
      { step: 3, action: 'Check for injury', detail: 'Look for bleeding, deformity (broken bone), inability to move limbs. Any of these = call 911.', urgent: false },
      { step: 4, action: 'If safe to help up', detail: 'Get a sturdy chair. Roll patient to side, push up to sitting, rest, then stand. Never pull by arms.', urgent: false },
      { step: 5, action: 'Check medications', detail: 'Blood thinners (aspirin, warfarin) increase bleeding risk. Head injury with blood thinners = ER visit required.', urgent: false },
      { step: 6, action: 'Document everything', detail: 'Time, location, what they were doing, symptoms. This is needed for doctor visit and insurance.', urgent: false },
      { step: 7, action: 'Follow up within 24 hours', detail: 'Call Dr. Martinez. Falls in elderly patients require assessment for cause (low BP, medication, balance).', urgent: false }
    ],
    emergency_contacts: ['911'],
    hospital_prep: 'For head injury with blood thinners — tell ER immediately. CT scan likely required.'
  },
  medication_emergency: {
    id: 'medication_emergency',
    title: 'Medication Emergency',
    icon: 'pills',
    color: '#ef4444',
    triggers: ['overdose','took too much','wrong medication','allergic reaction','hives','swelling','anaphylaxis'],
    steps: [
      { step: 1, action: 'Call 911 or Poison Control', detail: 'Poison Control: 1-800-222-1222 (24/7). For anaphylaxis (throat swelling, can\'t breathe) — 911 immediately.', urgent: true },
      { step: 2, action: 'Have medications ready', detail: 'Collect ALL medication bottles. Paramedics need to know exactly what was taken and when.', urgent: true },
      { step: 3, action: 'For allergic reaction', detail: 'If prescribed EpiPen — use immediately. Call 911. Keep patient still. Second EpiPen may be needed in 5-15 min.', urgent: true },
      { step: 4, action: 'Do NOT induce vomiting', detail: 'Unless Poison Control specifically instructs you to. Some medications cause more damage coming back up.', urgent: false },
      { step: 5, action: 'Stay on phone', detail: 'Keep Poison Control or 911 on the line until help arrives. Follow their exact instructions.', urgent: false }
    ],
    emergency_contacts: ['911', 'Poison Control: 1-800-222-1222'],
    hospital_prep: 'Linda\'s allergies: Penicillin, Sulfa drugs. Current medications: Lisinopril, Metformin, Synthroid, Lamotrigine, Vitamin D3.'
  },
  chest_pain: {
    id: 'chest_pain',
    title: 'Chest Pain / Heart Attack',
    icon: 'heart-pulse',
    color: '#ef4444',
    triggers: ['chest pain','heart attack','chest pressure','heart','left arm pain','jaw pain'],
    steps: [
      { step: 1, action: 'CALL 911 NOW', detail: 'Do not drive. Do not wait to see if it gets better. Every minute of delay = more heart damage.', urgent: true },
      { step: 2, action: 'Chew aspirin if available', detail: '325mg regular aspirin or 4 baby aspirin — chew, do not swallow whole. Only if not allergic. NOT ibuprofen.', urgent: true },
      { step: 3, action: 'Sit or lie down', detail: 'Stop all activity. Loosen tight clothing. Sit in position of most comfort. Stay calm.', urgent: false },
      { step: 4, action: 'Unlock front door', detail: 'Unlock door for paramedics before they arrive. Have someone wait outside if possible.', urgent: false },
      { step: 5, action: 'Do NOT eat or drink', detail: 'Patient may need emergency procedure. Nothing by mouth.', urgent: false },
      { step: 6, action: 'Tell paramedics', detail: 'Current medications (Lisinopril for BP), allergies (Penicillin, Sulfa), last meal time, when pain started.', urgent: false }
    ],
    emergency_contacts: ['911'],
    hospital_prep: 'Methodist Hospital — tell ER "chest pain" for immediate cardiac priority. They will run EKG within 10 minutes.'
  },
  insurance_denial: {
    id: 'insurance_denial',
    title: 'Insurance Denial',
    icon: 'file-invoice',
    color: '#3b82f6',
    triggers: ['denied','denial','insurance rejected','prior auth denied','not covered'],
    steps: [
      { step: 1, action: 'Get the denial in writing', detail: 'Request Explanation of Benefits (EOB) if you don\'t have it. You cannot appeal without the denial reason code.', urgent: false },
      { step: 2, action: 'Note the appeal deadline', detail: 'Medicare: 120 days. Most private insurance: 30-180 days. Missing deadline = losing right to appeal.', urgent: true },
      { step: 3, action: 'Identify denial reason', detail: 'Common codes: not medically necessary, experimental, out of network, prior auth missing, wrong code.', urgent: false },
      { step: 4, action: 'Request peer-to-peer review', detail: 'Ask insurance for doctor-to-doctor review. Your doctor calls their medical director. Overturns 50-70% of denials.', urgent: false },
      { step: 5, action: 'Gather medical necessity docs', detail: 'Clinical notes, lab results, prior treatment failures, specialist letters. More documentation = better odds.', urgent: false },
      { step: 6, action: 'File formal appeal', detail: 'Use Health Agent to draft a complete appeal letter with medical necessity arguments and policy citations.', urgent: false },
      { step: 7, action: 'Request external review', detail: 'If internal appeal fails — request independent external review. Federally mandated right. Free to request.', urgent: false }
    ],
    emergency_contacts: ['Medicare: 1-800-MEDICARE', 'Insurance Commissioner: file complaint if denied wrongly'],
    hospital_prep: 'Linda\'s insurance: Medicare + Aetna Supplement Plan G. Member ID: 6VG3-TR1-TK42.'
  },
  end_of_life_admin: {
    id: 'end_of_life_admin',
    title: 'End of Life Administration',
    icon: 'file-medical',
    color: '#8b5cf6',
    triggers: ['passed away','died','death certificate','social security','survivor benefit'],
    steps: [
      { step: 1, action: 'Notify Social Security within 24 hours', detail: 'Call 1-800-772-1213. Do NOT cash any SS checks after date of death — must be returned.', urgent: true },
      { step: 2, action: 'Get certified death certificates', detail: 'Order 10-15 copies from county clerk. You\'ll need them for: bank, insurance, Social Security, DMV, IRS, employer.', urgent: true },
      { step: 3, action: 'Notify life insurance companies', detail: 'File claims within 30 days typically. Have: policy numbers, death certificate, beneficiary ID.', urgent: false },
      { step: 4, action: 'Notify Medicare/Medicaid', detail: 'Call 1-800-MEDICARE. They will coordinate with Social Security.', urgent: false },
      { step: 5, action: 'Contact financial institutions', detail: 'Banks, investment accounts, retirement accounts. Need death certificate and your ID as beneficiary.', urgent: false },
      { step: 6, action: 'Apply for survivor benefits', detail: 'Social Security survivor benefit: spouse or dependent may qualify. Apply within 6 months for back pay eligibility.', urgent: false },
      { step: 7, action: 'File final tax return', detail: 'Federal and state returns still required for year of death. Estate may need to file as well if assets > $12.9M.', urgent: false }
    ],
    emergency_contacts: ['Social Security: 1-800-772-1213', 'Medicare: 1-800-MEDICARE'],
    hospital_prep: 'Keep advance directives, will, and insurance policies in one accessible location.'
  },
  international_medical: {
    id: 'international_medical',
    title: 'International Medical Emergency',
    icon: 'globe',
    color: '#0ea5e9',
    triggers: ['abroad','overseas','international','traveling','foreign hospital','medical evacuation'],
    steps: [
      { step: 1, action: 'Call local emergency services', detail: 'Know local emergency number before traveling. EU: 112. UK: 999. Mexico: 911. Japan: 119.', urgent: true },
      { step: 2, action: 'Contact US Embassy', detail: 'US Embassy can provide list of local doctors and hospitals. Find your embassy: travel.state.gov.', urgent: true },
      { step: 3, action: 'Call travel insurance', detail: 'If you have travel insurance — call their emergency line immediately. They coordinate evacuation, hospital payments.', urgent: false },
      { step: 4, action: 'Contact Medicare', detail: 'Medicare generally does NOT cover international care. Supplemental (Medigap Plan G) may cover 80% of emergency care abroad.', urgent: false },
      { step: 5, action: 'Medical evacuation', detail: 'If serious — request medical evacuation to US or nearest appropriate facility. Travel insurance or MedJet handles this.', urgent: false },
      { step: 6, action: 'Document everything', detail: 'Get all records, bills, diagnoses in writing. You\'ll need for insurance reimbursement and US doctors.', urgent: false }
    ],
    emergency_contacts: ['US Embassy: travel.state.gov', 'International SOS: 1-215-942-8226', 'MedJet: 1-800-527-7478'],
    hospital_prep: 'Aetna Supplement Plan G covers emergency care abroad at 80% after $250 deductible, up to $50,000 lifetime.'
  }
};

function getPlaybook(id) {
  return PLAYBOOKS[id] || null;
}

function getAllPlaybooks() {
  return Object.values(PLAYBOOKS).map(p => ({
    id: p.id, title: p.title, icon: p.icon, color: p.color, stepCount: p.steps.length
  }));
}

function detectPlaybook(text) {
  const lower = (text||'').toLowerCase();
  for(const [id, pb] of Object.entries(PLAYBOOKS)) {
    if(pb.triggers.some(t => lower.includes(t))) return pb;
  }
  return null;
}

module.exports = { getPlaybook, getAllPlaybooks, detectPlaybook, PLAYBOOKS };
