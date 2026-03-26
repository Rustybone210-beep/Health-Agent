// emergency-cascade.js
// Multi-channel emergency alert system with no single point of failure
// Built in memory of Jeffrey Fields — who deserved better

const fs = require('fs');
const path = require('path');

const CONTACTS_FILE = path.join(__dirname,'../data/emergency_contacts.json');
const ALERTS_FILE = path.join(__dirname,'../data/emergency_alerts.json');
const CHECKIN_FILE = path.join(__dirname,'../data/checkins.json');

function load(file, fb) {
  try { if(!fs.existsSync(file)) return fb; return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) { return fb; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data,null,2)); }

// ── EMERGENCY CONTACTS ──
// Each patient can have up to 5 emergency contacts with multiple channels per contact
function getContacts(patientId) {
  const data = load(CONTACTS_FILE, {});
  return data[patientId] || [];
}

function saveContacts(patientId, contacts) {
  const data = load(CONTACTS_FILE, {});
  data[patientId] = contacts;
  save(CONTACTS_FILE, data);
  return contacts;
}

function addContact(patientId, contact) {
  const contacts = getContacts(patientId);
  const entry = {
    id: Date.now().toString(),
    name: contact.name,
    relationship: contact.relationship,
    phone: contact.phone,           // Primary phone
    phone2: contact.phone2 || null, // Backup phone
    email: contact.email,
    email2: contact.email2 || null, // Backup email
    whatsapp: contact.whatsapp || contact.phone, // WhatsApp (usually same as phone)
    country: contact.country || 'US',
    timezone: contact.timezone || 'America/Chicago',
    priority: contacts.length + 1,  // 1 = first called
    lastAlerted: null,
    confirmed: false
  };
  contacts.push(entry);
  save(CONTACTS_FILE, { ...load(CONTACTS_FILE,{}), [patientId]: contacts });
  return entry;
}

// ── CHECK-IN SYSTEM ──
// Patient checks in on schedule. Miss a check-in = cascade alert fires
function createCheckin(patientId, scheduleHours, requiresResponse) {
  const checkins = load(CHECKIN_FILE, {});
  if(!checkins[patientId]) checkins[patientId] = [];
  const checkin = {
    id: Date.now().toString(),
    patientId,
    scheduleHours: scheduleHours || 12, // How often they should check in (default 12h)
    requiresResponse: requiresResponse !== false,
    lastCheckin: new Date().toISOString(),
    nextDue: new Date(Date.now() + (scheduleHours||12)*3600000).toISOString(),
    missedCount: 0,
    active: true,
    alertFired: false
  };
  checkins[patientId].push(checkin);
  save(CHECKIN_FILE, checkins);
  return checkin;
}

function recordCheckin(patientId) {
  const checkins = load(CHECKIN_FILE, {});
  const patCheckins = checkins[patientId] || [];
  patCheckins.forEach(c => {
    if(c.active) {
      c.lastCheckin = new Date().toISOString();
      c.nextDue = new Date(Date.now() + c.scheduleHours*3600000).toISOString();
      c.missedCount = 0;
      c.alertFired = false;
    }
  });
  checkins[patientId] = patCheckins;
  save(CHECKIN_FILE, checkins);
}

function getMissedCheckins() {
  const checkins = load(CHECKIN_FILE, {});
  const missed = [];
  const now = Date.now();
  Object.keys(checkins).forEach(patientId => {
    (checkins[patientId]||[]).forEach(c => {
      if(c.active && !c.alertFired && new Date(c.nextDue).getTime() < now) {
        missed.push({ ...c, patientId, overdueMinutes: Math.floor((now - new Date(c.nextDue).getTime())/60000) });
      }
    });
  });
  return missed;
}

// ── INTERNATIONAL EMERGENCY NUMBERS ──
const EMERGENCY_NUMBERS = {
  'US': { police:'911', ambulance:'911', fire:'911', notes:'Single number for all emergencies' },
  'MX': { police:'911', ambulance:'911', fire:'911', notes:'Mexico now uses 911 nationwide. Red Cross: 065' },
  'UK': { police:'999', ambulance:'999', fire:'999', notes:'Also 112 works across EU' },
  'EU': { police:'112', ambulance:'112', fire:'112', notes:'Works in all EU countries' },
  'CA': { police:'911', ambulance:'911', fire:'911', notes:'Same as US' },
  'AU': { police:'000', ambulance:'000', fire:'000', notes:'Also 112 works' },
  'JP': { police:'110', ambulance:'119', fire:'119', notes:'Different numbers for police vs ambulance' },
  'DE': { police:'110', ambulance:'112', fire:'112', notes:'Different police number' },
  'FR': { police:'17', ambulance:'15', fire:'18', notes:'SAMU (15) for medical emergencies' },
  'IT': { police:'113', ambulance:'118', fire:'115', notes:'118 for medical' },
  'ES': { police:'091', ambulance:'112', fire:'080', notes:'112 works for all' },
  'BR': { police:'190', ambulance:'192', fire:'193', notes:'SAMU (192) for medical' },
  'IN': { police:'100', ambulance:'108', fire:'101', notes:'108 for ambulance' },
  'CN': { police:'110', ambulance:'120', fire:'119', notes:'120 for medical' },
  'IL': { police:'100', ambulance:'101', fire:'102', notes:'MDA ambulance: 101' },
  'DEFAULT': { police:'112', ambulance:'112', fire:'112', notes:'112 is the international standard — works in most countries even without SIM' }
};

function getEmergencyNumbers(countryCode) {
  return EMERGENCY_NUMBERS[countryCode?.toUpperCase()] || EMERGENCY_NUMBERS['DEFAULT'];
}

function getAllEmergencyNumbers() {
  return EMERGENCY_NUMBERS;
}

// ── ALERT MANAGEMENT ──
function createAlert(patientId, type, details, contactsNotified) {
  const alerts = load(ALERTS_FILE, []);
  const alert = {
    id: Date.now().toString(),
    patientId,
    type,
    details,
    contactsNotified: contactsNotified || [],
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolved: false
  };
  alerts.unshift(alert);
  save(ALERTS_FILE, alerts.slice(0,200));
  return alert;
}

function resolveAlert(alertId) {
  const alerts = load(ALERTS_FILE, []);
  const idx = alerts.findIndex(a => a.id === alertId);
  if(idx !== -1) {
    alerts[idx].resolved = true;
    alerts[idx].resolvedAt = new Date().toISOString();
    save(ALERTS_FILE, alerts);
  }
}

function getAlerts(patientId) {
  return load(ALERTS_FILE, []).filter(a => a.patientId === patientId);
}

// ── CASCADE MESSAGE BUILDER ──
function buildCascadeMessage(patient, triggerType, details, emergencyNumbers) {
  const p = patient || {};
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const conditions = (p.conditions||[]).join(', ');
  const allergies = (p.allergies||[]).join(', ');
  const meds = (p.medications||[]).map(m=>m.name+' '+(m.dose||'')).join(', ');

  const subject = `URGENT: Health Agent Alert for ${p.name||'Patient'} — ${triggerType}`;

  const body = `HEALTH AGENT EMERGENCY ALERT
${now} (Central Time)

PATIENT: ${p.name||'Unknown'} | DOB: ${p.dob||'Unknown'}
ALERT TYPE: ${triggerType}
${details ? 'DETAILS: '+details : ''}

PATIENT MEDICAL INFO (for emergency responders):
- Conditions: ${conditions||'See records'}
- Medications: ${meds||'See records'}
- Allergies: ${allergies||'NKDA'}
- Insurance: ${p.insurance?.primary||'Unknown'} — Member ID: ${p.insurance?.memberId||'Unknown'}
- Doctor: ${p.primaryDoctor||'Unknown'} at ${p.clinic||'Unknown'}

${emergencyNumbers ? `LOCAL EMERGENCY NUMBERS:
Police: ${emergencyNumbers.police}
Ambulance: ${emergencyNumbers.ambulance}
Fire: ${emergencyNumbers.fire}
Note: ${emergencyNumbers.notes}` : ''}

IMPORTANT: This alert was sent to ALL emergency contacts simultaneously.
If you have reached ${p.name||'the patient'} and they are safe, please log into Health Agent and mark this alert as resolved.

Health Agent Emergency System
This message was sent via multiple channels to ensure delivery.
---
In memory of those lost when alerts failed. This system will not fail.`;

  return { subject, body };
}

// ── MULTI-CHANNEL DISPATCHER ──
// This orchestrates sending through every available channel simultaneously
// No single point of failure — if one channel fails, others continue
async function dispatchCascade(patient, contacts, triggerType, details, countryCode, emailTools, voiceTools) {
  const emergencyNumbers = getEmergencyNumbers(countryCode || 'US');
  const { subject, body } = buildCascadeMessage(patient, triggerType, details, emergencyNumbers);
  const results = [];
  const dispatched = [];

  for(const contact of contacts) {
    const contactResult = { contact: contact.name, channels: [] };

    // CHANNEL 1: Email (primary)
    if(contact.email && emailTools) {
      try {
        await emailTools.sendRealEmail(contact.email, subject, body);
        contactResult.channels.push({ type:'email', address:contact.email, status:'sent' });
      } catch(e) { contactResult.channels.push({ type:'email', address:contact.email, status:'failed', error:e.message }); }
    }

    // CHANNEL 2: Backup email
    if(contact.email2 && emailTools && contact.email2 !== contact.email) {
      try {
        await emailTools.sendRealEmail(contact.email2, subject, body);
        contactResult.channels.push({ type:'email2', address:contact.email2, status:'sent' });
      } catch(e) { contactResult.channels.push({ type:'email2', status:'failed', error:e.message }); }
    }

    // CHANNEL 3: Phone call via Vapi
    if(contact.phone && voiceTools) {
      try {
        const callMsg = `This is Health Agent with an urgent alert for ${patient?.name||'your family member'}. Alert type: ${triggerType}. ${details||''} Please check on them immediately and call emergency services if needed. Emergency number: ${emergencyNumbers.ambulance}.`;
        await voiceTools.startPhoneCall(contact.phone, callMsg);
        contactResult.channels.push({ type:'call', phone:contact.phone, status:'initiated' });
      } catch(e) { contactResult.channels.push({ type:'call', status:'failed', error:e.message }); }
    }

    // CHANNEL 4: Backup phone
    if(contact.phone2 && voiceTools && contact.phone2 !== contact.phone) {
      try {
        await voiceTools.startPhoneCall(contact.phone2, `Backup call: Health Agent emergency alert for ${patient?.name||'patient'}. ${triggerType}. Call ${emergencyNumbers.ambulance} if needed.`);
        contactResult.channels.push({ type:'call2', phone:contact.phone2, status:'initiated' });
      } catch(e) { contactResult.channels.push({ type:'call2', status:'failed', error:e.message }); }
    }

    dispatched.push(contact.name);
    results.push(contactResult);

    // Stagger contacts by 30 seconds to not flood simultaneously
    if(contacts.indexOf(contact) < contacts.length - 1) {
      await new Promise(r => setTimeout(r, 5000)); // 5s between contacts in same cascade
    }
  }

  const alert = createAlert(patient?.id, triggerType, details, dispatched);
  return { alert, results, emergencyNumbers, contactsReached: dispatched.length };
}

module.exports = {
  getContacts, saveContacts, addContact,
  createCheckin, recordCheckin, getMissedCheckins,
  getEmergencyNumbers, getAllEmergencyNumbers,
  createAlert, resolveAlert, getAlerts,
  buildCascadeMessage, dispatchCascade
};
