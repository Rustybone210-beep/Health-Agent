// symptom-triage.js — AI-powered symptom triage
// Is this ER, urgent care, call doctor, or monitor at home?

const TRIAGE_LEVELS = {
  ER_NOW: { level: 'er_now', label: 'Go to ER Now', color: '#ef4444', icon: 'triangle-exclamation', urgency: 5 },
  CALL_911: { level: 'call_911', label: 'Call 911', color: '#ef4444', icon: 'phone', urgency: 5 },
  URGENT_CARE: { level: 'urgent_care', label: 'Urgent Care Today', color: '#f59e0b', icon: 'clock', urgency: 4 },
  CALL_DOCTOR: { level: 'call_doctor', label: 'Call Doctor Today', color: '#f59e0b', icon: 'phone', urgency: 3 },
  SCHEDULE: { level: 'schedule', label: 'Schedule Appointment', color: '#3b82f6', icon: 'calendar', urgency: 2 },
  MONITOR: { level: 'monitor', label: 'Monitor at Home', color: '#22c55e', icon: 'house', urgency: 1 }
};

// Red flag symptoms that always = ER or 911
const RED_FLAGS = [
  { keywords: ['chest pain','chest pressure','chest tightness'], triage: 'CALL_911', reason: 'Chest pain can indicate heart attack. Time-critical.', doNotWait: true },
  { keywords: ['cant breathe','cannot breathe',"can't breathe",'difficulty breathing','shortness of breath','trouble breathing'], triage: 'CALL_911', reason: 'Breathing difficulty can be life-threatening.', doNotWait: true },
  { keywords: ['face drooping','arm weakness','speech slurred','sudden numbness','stroke'], triage: 'CALL_911', reason: 'These are stroke warning signs. Every minute matters.', doNotWait: true },
  { keywords: ['unconscious','unresponsive','not breathing','no pulse'], triage: 'CALL_911', reason: 'Call 911 immediately. Begin CPR if trained.', doNotWait: true },
  { keywords: ['overdose','took too many','took too much medicine'], triage: 'CALL_911', reason: 'Call 911 and Poison Control (1-800-222-1222).', doNotWait: true },
  { keywords: ['seizure','convulsing','convulsions','shaking uncontrollably'], triage: 'CALL_911', reason: 'Seizure lasting more than 5 minutes requires emergency care.', doNotWait: true },
  { keywords: ['severe bleeding','bleeding wont stop','blood wont stop'], triage: 'CALL_911', reason: 'Apply pressure and call 911 for severe bleeding.', doNotWait: true },
  { keywords: ['allergic reaction','throat swelling','anaphylaxis','epipen'], triage: 'CALL_911', reason: 'Anaphylaxis is life-threatening. Use EpiPen if available, call 911.', doNotWait: true },
  { keywords: ['sudden vision loss','vision gone','cant see','cannot see'], triage: 'ER_NOW', reason: 'Sudden vision loss can indicate stroke or retinal emergency.', doNotWait: true },
  { keywords: ['severe head pain','worst headache','thunderclap headache'], triage: 'ER_NOW', reason: 'Sudden severe headache can indicate brain bleed.', doNotWait: true }
];

const URGENT_SYMPTOMS = [
  { keywords: ['high fever','fever over 103','fever 104','fever 105'], triage: 'ER_NOW', reason: 'High fever especially in elderly requires immediate evaluation.' },
  { keywords: ['severe abdominal pain','stomach pain severe'], triage: 'URGENT_CARE', reason: 'Severe abdominal pain needs same-day evaluation.' },
  { keywords: ['fall','fell down','fell'], triage: 'URGENT_CARE', reason: 'Falls in elderly patients need evaluation for injury, especially with blood thinners.' },
  { keywords: ['confusion','suddenly confused','disoriented'], triage: 'URGENT_CARE', reason: 'Sudden confusion in elderly can indicate infection, stroke, or medication issue.' },
  { keywords: ['blood in urine','blood in stool','rectal bleeding'], triage: 'URGENT_CARE', reason: 'Blood in urine or stool needs same-day evaluation.' },
  { keywords: ['severe dizziness','room spinning','cant stand','cannot stand'], triage: 'URGENT_CARE', reason: 'Severe vertigo needs evaluation especially with fall risk.' },
  { keywords: ['broken bone','fracture','bone sticking out'], triage: 'ER_NOW', reason: 'Suspected fractures need imaging and treatment.' },
  { keywords: ['eye injury','something in eye','chemical in eye'], triage: 'ER_NOW', reason: 'Eye injuries are time-sensitive emergencies.' },
  { keywords: ['severe vomiting','cant keep anything down','cannot keep anything down'], triage: 'URGENT_CARE', reason: 'Dehydration risk, especially in elderly and diabetic patients.' },
  { keywords: ['fever','temperature high'], triage: 'CALL_DOCTOR', reason: 'Fever needs evaluation. High fever (>103°F) warrants urgent care.' },
  { keywords: ['rash spreading','spreading rash','rash getting worse'], triage: 'CALL_DOCTOR', reason: 'Spreading rash needs evaluation for allergic reaction or infection.' },
  { keywords: ['swollen leg','leg swelling','calf pain','leg pain'], triage: 'URGENT_CARE', reason: 'Leg swelling can indicate blood clot (DVT). Needs same-day evaluation.' },
  { keywords: ['wound not healing','infected wound','wound infection'], triage: 'CALL_DOCTOR', reason: 'Non-healing wounds in diabetic patients need prompt attention.' },
  { keywords: ['blood sugar very high','blood sugar 400','blood sugar 300'], triage: 'URGENT_CARE', reason: 'Very high blood sugar can lead to diabetic emergency.' },
  { keywords: ['blood sugar very low','blood sugar 50','blood sugar 40','hypoglycemia'], triage: 'ER_NOW', reason: 'Severe low blood sugar can cause unconsciousness. Give glucose now.' }
];

function triageSymptom(symptomText, patient) {
  const lower = (symptomText || '').toLowerCase();
  const p = patient || {};
  const conditions = (p.conditions || []).map(c => c.toLowerCase());
  const meds = (p.medications || []).map(m => m.name.toLowerCase());
  const hasBloodThinner = meds.some(m => ['warfarin','coumadin','eliquis','xarelto','aspirin','plavix'].some(bt => m.includes(bt)));
  const hasDiabetes = conditions.some(c => c.includes('diabetes'));
  const isElderly = p.dob ? (new Date().getFullYear() - new Date(p.dob).getFullYear()) >= 65 : false;

  // Check red flags first
  for(const flag of RED_FLAGS) {
    if(flag.keywords.some(kw => lower.includes(kw))) {
      return {
        triage: TRIAGE_LEVELS[flag.triage],
        reason: flag.reason,
        doNotWait: flag.doNotWait || false,
        patientFactors: [],
        nextSteps: getNextSteps(flag.triage, p),
        disclaimer: 'This triage assessment does not replace professional medical evaluation. When in doubt, seek immediate care.'
      };
    }
  }

  // Check urgent symptoms with patient-specific modifiers
  for(const symptom of URGENT_SYMPTOMS) {
    if(symptom.keywords.some(kw => lower.includes(kw))) {
      let triageLevel = symptom.triage;
      const factors = [];

      // Escalate for high-risk patients
      if(isElderly && ['MONITOR','CALL_DOCTOR'].includes(triageLevel)) {
        triageLevel = 'CALL_DOCTOR';
        factors.push('Age 65+ increases risk — seek care sooner than you might for a younger person');
      }
      if(hasBloodThinner && lower.includes('fall')) {
        triageLevel = 'ER_NOW';
        factors.push('Blood thinner medications increase bleeding risk from falls significantly');
      }
      if(hasDiabetes && (lower.includes('wound') || lower.includes('infection'))) {
        triageLevel = 'CALL_DOCTOR';
        factors.push('Diabetes slows healing and increases infection risk');
      }

      return {
        triage: TRIAGE_LEVELS[triageLevel],
        reason: symptom.reason,
        doNotWait: false,
        patientFactors: factors,
        nextSteps: getNextSteps(triageLevel, p),
        disclaimer: 'This triage assessment does not replace professional medical evaluation. When in doubt, seek immediate care.'
      };
    }
  }

  // Default — monitor and call doctor if worsens
  return {
    triage: TRIAGE_LEVELS['MONITOR'],
    reason: 'Based on the symptoms described, home monitoring may be appropriate. Watch for worsening.',
    doNotWait: false,
    patientFactors: isElderly ? ['As someone 65+, watch symptoms closely — things can change quickly'] : [],
    nextSteps: [
      'Monitor symptoms closely for the next 24 hours',
      `Call ${p.primaryDoctor || 'your doctor'} if symptoms worsen or don\'t improve`,
      'Go to urgent care or ER if any new concerning symptoms develop',
      'Document symptoms with timing for your doctor visit'
    ],
    disclaimer: 'This triage assessment does not replace professional medical evaluation. When in doubt, seek care.'
  };
}

function getNextSteps(triageLevel, patient) {
  const p = patient || {};
  const steps = {
    CALL_911: ['Call 911 immediately', 'Unlock front door for paramedics', 'Do not give food or water', `Tell paramedics: ${p.name || 'patient'}, allergies: ${(p.allergies||[]).join(', ')||'none known'}`],
    ER_NOW: [`Go to ${p.preferredHospital || 'nearest emergency room'} now`, 'Bring photo ID and insurance card', `Bring medication list: ${(p.medications||[]).map(m=>m.name).join(', ')||'see profile'}`, 'Tell triage your symptoms immediately upon arrival'],
    URGENT_CARE: ['Find nearest urgent care — open now', 'Call ahead to confirm wait time', 'Bring insurance card and medication list', `Call ${p.primaryDoctor || 'your doctor'} to inform them of urgent care visit`],
    CALL_DOCTOR: [`Call ${p.primaryDoctor || 'doctor'} office now`, 'If no answer, call after-hours line', 'Document symptoms with exact timing', 'Take temperature and vitals if possible'],
    SCHEDULE: [`Schedule appointment with ${p.primaryDoctor || 'your doctor'}`, 'Log symptoms daily until appointment', 'Note any triggers or patterns'],
    MONITOR: ['Monitor for changes every few hours', 'Keep a symptom log', 'Watch for red flags: fever, worsening pain, difficulty breathing', 'Call doctor if no improvement in 24-48 hours']
  };
  return steps[triageLevel] || steps['MONITOR'];
}

module.exports = { triageSymptom, TRIAGE_LEVELS, RED_FLAGS };
