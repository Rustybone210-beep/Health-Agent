// legal-safety.js — Legal disclaimers, safety checks, emergency detection
const EMERGENCY_KEYWORDS = [
  'chest pain','heart attack','stroke','cant breathe','can\'t breathe','not breathing',
  'unconscious','unresponsive','severe bleeding','overdose','suicidal','suicide',
  'seizure','paralyzed','sudden numbness','severe head pain','vision loss',
  'confusion sudden','face drooping','arm weakness','speech difficulty'
];

const DISCLAIMER = `\n\n---\n⚕️ *Health Agent provides information and navigation support — not medical advice. Always consult your physician before making any health decisions. In case of emergency, call 911 immediately.*`;

const SHORT_DISCLAIMER = `\n\n*Not medical advice — verify with your doctor.*`;

function checkEmergency(text) {
  const lower = (text||'').toLowerCase();
  return EMERGENCY_KEYWORDS.some(kw => lower.includes(kw));
}

function addDisclaimer(response, short=false) {
  if(!response) return response;
  // Don't double-add
  if(response.includes('⚕️') || response.includes('Not medical advice')) return response;
  return response + (short ? SHORT_DISCLAIMER : DISCLAIMER);
}

function buildEmergencyResponse(symptom) {
  return `🚨 **This sounds like a potential medical emergency.**

If ${symptom||'these symptoms are'} severe or sudden, **call 911 immediately** or go to the nearest emergency room.

**Do not wait** to see if symptoms improve on their own.

Emergency contacts:
- **911** — Life-threatening emergency
- **Poison Control: 1-800-222-1222**
- **Crisis Line: 988** (mental health)

${DISCLAIMER}`;
}

function getConsentLanguage() {
  return `Health Agent is an AI-powered healthcare navigation assistant. By using this service:
- You understand this is NOT a substitute for professional medical advice
- You agree that all health information should be verified with a licensed physician
- You acknowledge that in emergencies you will call 911
- You understand AI can make mistakes and information should be cross-referenced
- All data is stored securely and HIPAA guidelines are followed`;
}

function auditHealthAdvice(response) {
  const hasAdvice = /you should|recommend|take|avoid|stop|start|increase|decrease/i.test(response);
  const hasDisclaimer = response.includes('doctor') || response.includes('physician') || response.includes('⚕️');
  return { hasAdvice, hasDisclaimer, needsDisclaimer: hasAdvice && !hasDisclaimer };
}

module.exports = { checkEmergency, addDisclaimer, buildEmergencyResponse, getConsentLanguage, auditHealthAdvice, DISCLAIMER, EMERGENCY_KEYWORDS };
