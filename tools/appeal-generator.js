// ============================================================
// appeal-generator.js — AI-powered insurance appeal auto-generator
//
// Generates complete appeal packages:
// 1. Formal appeal letter with medical necessity arguments
// 2. Denial code rebuttal using CMS guidelines
// 3. Supporting evidence checklist
// 4. Timeline and deadline tracking
// 5. Escalation instructions if appeal fails
// ============================================================

const DENIAL_CODE_REBUTTALS = {
  // Common Medicare denial codes
  'CO-4': { reason: 'Procedure code inconsistent with modifier', rebuttal: 'Request review with correct modifier combination per CPT guidelines.' },
  'CO-16': { reason: 'Claim lacks information', rebuttal: 'Resubmit with complete documentation. Missing fields identified below.' },
  'CO-18': { reason: 'Duplicate claim', rebuttal: 'This is not a duplicate. Services were provided on different dates/for different conditions.' },
  'CO-22': { reason: 'Payment adjusted — coordination of benefits', rebuttal: 'Primary insurance has processed. Secondary should pay remaining balance per COB rules.' },
  'CO-29': { reason: 'Payment adjusted — time limit expired', rebuttal: 'Filing delay was due to [reason]. Request exception per your timely filing exception policy.' },
  'CO-50': { reason: 'Not medically necessary', rebuttal: 'Service was medically necessary per treating physician. See attached letter of medical necessity and clinical guidelines.' },
  'CO-96': { reason: 'Non-covered charge', rebuttal: 'Service is covered under the patient\'s plan. See benefit summary and applicable coverage determination.' },
  'CO-97': { reason: 'Payment included in another service', rebuttal: 'Services are distinct and separately reportable per CPT coding guidelines. Modifier -59 applies.' },
  'CO-109': { reason: 'Not covered by this payer', rebuttal: 'Patient had active coverage on date of service. Verify eligibility records.' },
  'CO-197': { reason: 'Precertification/authorization not obtained', rebuttal: 'Authorization was obtained [number]. If not on file, provider will resubmit authorization documentation.' },
  'PR-1': { reason: 'Deductible amount', rebuttal: 'Patient has met deductible for this benefit period. See attached EOB showing deductible satisfied.' },
  'PR-2': { reason: 'Coinsurance amount', rebuttal: 'Coinsurance calculation appears incorrect. Expected coinsurance is [X]% per plan terms.' },
  'PR-3': { reason: 'Copay amount', rebuttal: 'Copay has been collected. Remaining balance should be processed to insurance.' },
};

// Medicare-specific appeal levels
const MEDICARE_APPEAL_LEVELS = [
  { level: 1, name: 'Redetermination', who: 'Medicare Administrative Contractor (MAC)', deadline: '120 days from initial determination', expectedTime: '60 days' },
  { level: 2, name: 'Reconsideration', who: 'Qualified Independent Contractor (QIC)', deadline: '180 days from redetermination', expectedTime: '60 days' },
  { level: 3, name: 'Administrative Law Judge (ALJ) Hearing', who: 'Office of Medicare Hearings and Appeals', deadline: '60 days from reconsideration', expectedTime: '90 days', minAmount: '$180' },
  { level: 4, name: 'Medicare Appeals Council Review', who: 'Departmental Appeals Board', deadline: '60 days from ALJ decision', expectedTime: '90 days' },
  { level: 5, name: 'Federal District Court', who: 'U.S. District Court', deadline: '60 days from Appeals Council', minAmount: '$1,760' },
];

function getDenialRebuttal(code) {
  return DENIAL_CODE_REBUTTALS[code] || null;
}

function getMedicareAppealLevels() {
  return MEDICARE_APPEAL_LEVELS;
}

function buildAppealPackage(claim, patient, denialDetails = {}) {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const p = patient || {};
  const isMedicare = (p.insurance?.primary || '').toLowerCase().includes('medicare');

  // Get denial code rebuttal if available
  const codeRebuttal = denialDetails.denialCode ? getDenialRebuttal(denialDetails.denialCode) : null;

  // Calculate deadline
  const appealDeadline = claim.appealDeadline || (() => {
    const d = new Date();
    d.setDate(d.getDate() + (isMedicare ? 120 : 180));
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  })();

  // Build the formal letter
  const letter = `${todayStr}

${claim.insuranceName || p.insurance?.primary || 'Insurance Company'}
Claims Appeal Department
${denialDetails.insuranceAddress || '[Insurance Company Address]'}

RE: FORMAL APPEAL — CLAIM DENIAL
Patient: ${p.name || 'Patient Name'}
Date of Birth: ${p.dob || '___________'}
Member ID: ${p.insurance?.memberId || claim.memberId || '___________'}
${isMedicare ? 'Medicare Number: ' + (p.insurance?.medicareNumber || p.insurance?.memberId || '___________') + '\n' : ''}Claim Number: ${claim.id || denialDetails.claimNumber || '___________'}
Date of Service: ${claim.serviceDate || denialDetails.serviceDate || '___________'}
Provider: ${claim.providerName || denialDetails.providerName || '___________'}
${denialDetails.procedureCode ? 'CPT Code: ' + denialDetails.procedureCode + '\n' : ''}${denialDetails.diagnosisCode ? 'ICD-10 Code: ' + denialDetails.diagnosisCode + '\n' : ''}Billed Amount: $${(claim.chargedAmount || 0).toFixed(2)}

Dear Claims Review Department,

I am writing to formally appeal the denial of the above-referenced claim on behalf of ${p.name || 'the patient'}. ${p.name ? 'I am ' + p.name + '\'s authorized healthcare representative.' : ''}

DENIAL REASON:
${claim.denialReason || denialDetails.denialReason || 'The claim was denied without a clearly stated reason. Please provide the specific denial code and rationale.'}
${codeRebuttal ? '\nDenial Code ' + denialDetails.denialCode + ': ' + codeRebuttal.reason : ''}

GROUNDS FOR APPEAL:
${codeRebuttal ? codeRebuttal.rebuttal + '\n' : ''}
${denialDetails.medicalNecessity || 'The treatment/service provided was medically necessary as determined by the treating physician. The patient\'s condition required this specific treatment, and failure to provide it would result in deterioration of the patient\'s health.'}

${claim.appeal?.reason ? 'ADDITIONAL JUSTIFICATION:\n' + claim.appeal.reason + '\n' : ''}SUPPORTING DOCUMENTATION ENCLOSED:
1. Letter of Medical Necessity from treating physician
2. Relevant medical records and clinical notes
3. ${isMedicare ? 'Medicare Coverage Determination / National Coverage Decision' : 'Plan benefit summary showing coverage'}
4. Clinical practice guidelines supporting this treatment
5. Prescription records (if medication-related)
${denialDetails.additionalDocs ? denialDetails.additionalDocs.map((d, i) => (i + 6) + '. ' + d).join('\n') : ''}

REGULATORY BASIS:
${isMedicare ?
`Under 42 CFR §405.904, I have the right to appeal this determination. This constitutes a Level 1 Redetermination request. If this appeal is denied, I intend to pursue all available levels of appeal including Reconsideration by a Qualified Independent Contractor, Administrative Law Judge hearing, Medicare Appeals Council review, and Federal District Court review as necessary.` :
`Under ${p.address?.includes('TX') || denialDetails.state === 'TX' ? 'Texas Insurance Code §1301 and' : ''} the Employee Retirement Income Security Act (ERISA), I have the right to a full and fair review of this claim denial. The plan is required to provide a written explanation of the denial and the specific plan provisions on which the denial is based.`}

${denialDetails.urgency === 'expedited' ? 'EXPEDITED REVIEW REQUESTED:\nDue to the urgency of the patient\'s medical condition, I am requesting an expedited review of this appeal. The patient\'s health may be seriously jeopardized by delay.\n' : ''}REQUEST:
1. Conduct a full and fair review of this appeal by a qualified medical reviewer
2. Reverse the denial and process this claim for payment
3. Provide a written explanation of your decision within the required timeframe
4. If denied, provide specific clinical rationale and instructions for further appeal

Please contact me at the address on file if additional information is needed. I expect a response within ${isMedicare ? '60 days' : '30 days'} as required by ${isMedicare ? 'CMS regulations' : 'applicable state and federal law'}.

Sincerely,

________________________________
${p.name || 'Patient/Authorized Representative'}
Member ID: ${p.insurance?.memberId || claim.memberId || '___________'}
Phone: ${p.phone || '___________'}
Date: ${todayStr}

CC: ${claim.providerName || 'Treating Physician'}
    State Insurance Commissioner (if applicable)`;

  // Build supporting evidence checklist
  const checklist = [
    { item: 'Copy of the denial letter/EOB', required: true, have: !!denialDetails.denialLetter },
    { item: 'Letter of medical necessity from treating physician', required: true, have: false },
    { item: 'Relevant medical records and clinical notes', required: true, have: false },
    { item: 'Prescription records (if medication-related)', required: claim.type === 'prescription', have: false },
    { item: 'Lab results supporting diagnosis', required: false, have: false },
    { item: 'Clinical practice guidelines (peer-reviewed)', required: false, have: false },
    { item: isMedicare ? 'Medicare coverage determination' : 'Plan benefit summary', required: true, have: false },
    { item: 'Prior authorization documentation', required: !!denialDetails.priorAuth, have: !!denialDetails.priorAuth },
    { item: 'Copy of insurance card (front and back)', required: true, have: true },
    { item: 'Signed authorization for representative', required: true, have: true },
  ].filter(i => i.required || !i.required);

  // Build escalation plan
  const escalation = isMedicare ? MEDICARE_APPEAL_LEVELS : [
    { level: 1, name: 'Internal Appeal', who: claim.insuranceName || 'Insurance Company', deadline: '180 days from denial', expectedTime: '30 days' },
    { level: 2, name: 'External Review', who: 'Independent Review Organization (IRO)', deadline: '4 months from internal appeal denial', expectedTime: '45 days' },
    { level: 3, name: 'State Insurance Commissioner Complaint', who: 'Texas Department of Insurance', deadline: 'No deadline', expectedTime: '30-60 days' },
    { level: 4, name: 'Legal Action', who: 'Attorney / Small Claims Court', deadline: 'Varies by state', expectedTime: 'Varies' },
  ];

  return {
    letter,
    checklist,
    escalation,
    deadline: appealDeadline,
    isMedicare,
    denialCode: denialDetails.denialCode || null,
    codeRebuttal,
    phoneScript: buildPhoneFollowUpScript(claim, patient),
  };
}

function buildPhoneFollowUpScript(claim, patient) {
  const p = patient || {};
  return `PHONE FOLLOW-UP SCRIPT (call 7 days after mailing appeal):

"Hello, I'm calling on behalf of ${p.name || 'the patient'}, member ID ${p.insurance?.memberId || claim.memberId || '___'}. I'm following up on an appeal submitted on [DATE].

Could you please confirm:
1. Was the appeal received?
2. What is the current status?
3. Who is the reviewer assigned to this case?
4. When can we expect a decision?
5. Is any additional documentation needed?

My reference number for the appeal is: ___________
Please note I am the patient's authorized representative."`;
}

module.exports = {
  buildAppealPackage,
  getDenialRebuttal,
  getMedicareAppealLevels,
  buildPhoneFollowUpScript,
  DENIAL_CODE_REBUTTALS,
};
