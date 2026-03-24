// ============================================================
// server.js — AI Health Agent (Stabilized Upload + Calendar + Tasks)
// ============================================================
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;
// Conditionally load googleapis (only if installed)
let google = null;
try {
  google = require('googleapis').google;
} catch (e) {
  console.log('⚠️  googleapis not installed — Google Calendar disabled. Run: npm install googleapis');
}
const voice = require('./tools/voice');
const emailTools = require('./tools/email');
const calendarTools = require('./tools/calendar');
const patientsTools = require('./tools/patients');
const appointmentsTools = require('./tools/appointments');
const medicationsTools = require('./tools/medications');
const tasksTools = require('./tools/tasks');
const concernsTools = require('./tools/concerns');
const rxRefillTools = require('./tools/rx-refill');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use('/drafts', express.static('drafts'));
app.use('/calendar', express.static('calendar'));
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }
});
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});
// ─── Data File Paths ───────────────────────────────────────
const CHAT_HISTORY_FILE = './data/chat_history.json';
const NOTIFICATIONS_FILE = './data/notifications.json';
const CURRENT_PATIENT_FILE = './data/current_patient.json';
const TOKEN_FILE = './data/google_tokens.json';
const TIMELINE_FILE = './data/timeline.json';
const PATIENTS_FILE = './data/patients.json';
// ─── Ensure directories exist ──────────────────────────────
['./data', './drafts', './calendar', './uploads'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
// ─── Session State ─────────────────────────────────────────
let pendingUpdates = null;
let pendingEmailDraft = null;
let pendingCallRequest = null;
let conversationHistory = [];
// ─── Generic Helpers ───────────────────────────────────────
function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function safeWriteJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}
}
function normalizeUSPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(phone).startsWith('+')) return String(phone);
  return phone;
}
function extractJsonAfterMarker(text, marker = 'EXTRACTED_DATA:') {
  if (!text || !text.includes(marker)) return null;
  const startIndex = text.indexOf(marker) + marker.length;
  let raw = text.slice(startIndex).trim();
  raw = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const jsonText = raw.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    console.log('JSON parse error:', e.message);
    return null;
  }
}
// ─── Chat history helpers ──────────────────────────────────
function loadChatHistory() {
  const data = safeReadJson(CHAT_HISTORY_FILE, { sessions: [] });
  return data.sessions || [];
}
function saveChatSession(patientId, messages) {
  try {
    const data = safeReadJson(CHAT_HISTORY_FILE, { sessions: [] });
    const session = {
      id: Date.now().toString(),
      patientId,
      timestamp: new Date().toISOString(),
      preview: messages.find((m) => m.role === 'user')?.content?.substring(0, 60) || 'Chat session',
      messages
    };
    data.sessions.unshift(session);
    data.sessions = data.sessions.slice(0, 50);
    safeWriteJson(CHAT_HISTORY_FILE, data);
    return session.id;
  } catch (e) {
    console.error('Error saving chat history:', e);
    return null;
  }
}
// ─── Notifications ─────────────────────────────────────────
function loadNotifications() {
  return safeReadJson(NOTIFICATIONS_FILE, { notifications: [] });
}
function saveNotifications(data) {
  safeWriteJson(NOTIFICATIONS_FILE, data);
}
function loadTimeline() {
  return safeReadJson(TIMELINE_FILE, { events: [] });
}
function addNotification(type, title, message, patientId = null, dueDate = null) {
  const data = loadNotifications();
  const notif = {
    id: Date.now().toString(),
    type,
    title,
    message,
    patientId,
    dueDate,
    read: false,
    createdAt: new Date().toISOString()
  };
  data.notifications.unshift(notif);
  saveNotifications(data);
  return notif;
}
// ─── Patient helpers ───────────────────────────────────────
function getCurrentPatientId() {
  const data = safeReadJson(CURRENT_PATIENT_FILE, { patientId: 'maria-fields' });
  return data.patientId || 'maria-fields';
}
function setCurrentPatientId(id) {
  safeWriteJson(CURRENT_PATIENT_FILE, { patientId: id });
}
function getAllPatients() {
  try {
    const data = safeReadJson(PATIENTS_FILE, []);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.patients)) return data.patients;
    if (data && typeof data === 'object') return [data];
    return [];
  } catch (e) {
    return [];
  }
}
function saveAllPatients(patients) {
  try {
    const existing = safeReadJson(PATIENTS_FILE, null);
    if (existing && existing.patients) {
      safeWriteJson(PATIENTS_FILE, { ...existing, patients });
    } else {
      safeWriteJson(PATIENTS_FILE, { patients });
    }
  } catch (e) {
    safeWriteJson(PATIENTS_FILE, { patients });
  }
}
// ─── System Prompt ─────────────────────────────────────────
function buildSystemPrompt(patient) {
  const p = patient || {};
  return `You are Health Agent — an AI healthcare navigator and caregiver command center. You help manage healthcare for patients and their families.
PATIENT PROFILE:
- Name: ${p.name || 'Unknown'}
- DOB: ${p.dob || 'Unknown'}
- Address: ${p.address || 'Unknown'}
- Insurance: ${p.insurance?.primary || ''} ${p.insurance?.secondary ? '+ ' + p.insurance.secondary : ''}
- Member ID: ${p.insurance?.memberId || ''}
- Conditions: ${(p.conditions || []).join(', ')}
- Allergies: ${(p.allergies || []).join(', ')}
- Doctor: ${p.primaryDoctor || 'Unknown'} at ${p.clinic || 'Unknown'}
- Preferred Hospital: ${p.preferredHospital || 'Unknown'}
- Pharmacy: ${p.pharmacy?.name || 'Unknown'} ${p.pharmacy?.phone || ''}
- Medications: ${(p.medications || []).map((m) => m.name + ' ' + (m.dose || '') + ' ' + (m.frequency || '')).join(', ')}
YOUR CAPABILITIES:
1. DOCUMENT ANALYSIS - Read uploaded medical documents, prescriptions, insurance cards, lab results
2. ACTION PLANS - Step-by-step plans with exact phone scripts
3. APPEAL LETTERS - Draft formal insurance appeals with medical necessity arguments
4. EMAIL SENDING - Draft and send real emails (use EMAIL_DRAFT format below)
5. PHONE CALLS - Trigger real phone calls to providers (use CALL_REQUEST format below)
6. CALENDAR - Detect appointment dates and suggest adding to Google Calendar (use CALENDAR_EVENT format)
7. MEDICATION MANAGEMENT - Track meds with doses, refill dates, pharmacy, prescriber, Rx numbers. Flag upcoming refills. Check for common drug interactions.
8. INSURANCE TRACKING - Track claims, denials, appeals
9. PROVIDER FINDER - Help find doctors who accept specific insurance plans. When user asks to find a doctor, ALWAYS respond with:
PROVIDER_SEARCH:{"insurance":"Insurance Name","specialty":"Doctor Type","location":"City, State"}
The system will generate clickable search links from Zocdoc, Healthgrades, and Google. Always include the tag so the user gets real search links.
10. DOCTOR SWITCHING - Help patients switch doctors. Walk them through: checking insurance network, getting records transferred, finding new providers, scheduling first appointments. Use PROVIDER_SEARCH to find alternatives.
11. MEDICAL TRANSLATION - Explain medical jargon in plain English
12. APPOINTMENT PREP - Checklists and questions to ask
15. LAB ANALYZER - When a user uploads lab results, the system automatically analyzes every value against reference ranges, flags abnormals, identifies critical values, and connects lab findings to medications and symptoms. For example: high cholesterol + serum tears = inflammatory tears on the eyes. Low TSH + weight gain = possible thyroid undertreatment. High SHBG + low estradiol = hormone depletion affecting dry eye. Always explain what flagged values mean in plain English and how they connect to the patient's conditions.
16. SYMPTOM-MEDICATION CORRELATOR - Track when medications change and when symptoms change. Automatically identify patterns like "eye symptoms worsened 14 days after Synthroid was reduced" or "burning improved 3 days after stopping serum tears." When users report symptoms, always ask about recent medication changes. When users report medication changes, warn about symptoms to watch for.
17. LIVING MEDICAL SUMMARY - A complete, always-updated medical summary that includes all medications, conditions, allergies, lab flags, symptom patterns, medication changes, and open tasks. Ready to print for any new doctor visit. Updated automatically with every scan, chat, and lab upload.
14. INSURANCE MATCHER - For uninsured users, match them to the right insurance program based on age, income, state, and family size. Programs include Medicare, Medicaid, ACA Marketplace (Obamacare), CHIP for children, and VA for veterans. Guide users through enrollment step by step. The system provides direct links to apply.
13. RX REFILL & PRICE COMPARISON - When a prescription bottle is scanned, the system automatically checks:
    - Is the Rx expired? How many refills remain? Is it running low?
    - Price comparison across GoodRx, Cost Plus Drugs (Mark Cuban), Amazon Pharmacy, SingleCare, RxSaver, Walmart
    - If expired or no refills: recommend calling the doctor for a new prescription
    - If refills available: recommend calling the pharmacy to refill
    - Always show the price comparison so the patient gets the best deal
    When discussing medications or refills, remind users they can scan their bottle to check status and compare prices.
CALL_REQUEST FORMAT: When user asks to call someone, respond with:
CALL_REQUEST:{"name":"Provider Name","phone":"+12105551234","reason":"Reason for calling"}
Then explain what the AI agent will say on the call. User will confirm before the call is made.
EMAIL_DRAFT FORMAT: When drafting an email, include:
EMAIL_DRAFT:{"to":"email@example.com","subject":"Subject Line","body":"Full email body text here"}
Then ask user to type 'send' to confirm, or suggest changes.
CALENDAR_EVENT FORMAT: When an appointment date is mentioned, include:
CALENDAR_EVENT:{"title":"Appointment Title","date":"YYYY-MM-DD","time":"HH:MM","duration":60,"description":"Details"}
CRITICAL RULES:
- NEVER fabricate phone numbers or confirmation numbers
- NEVER pretend to make phone calls — use CALL_REQUEST format and let the system handle it
- Be honest about what you can and cannot do
- Always ask for confirmation before sending emails or making calls
- Use **bold** for important information
- Always end with clear next steps
- You are an advocate for the patient — fight hard for their care
- When asked to find a doctor, ALWAYS include the PROVIDER_SEARCH tag so the user gets clickable links
DOCTOR SWITCHING WORKFLOW:
When a user wants to switch doctors, walk them through these steps:
1. Ask which doctor they want to switch FROM and what specialty they need
2. Use PROVIDER_SEARCH to find alternatives that accept their insurance
3. Offer to help call the current doctor for medical records transfer
4. Offer to schedule the first appointment with the new doctor
5. Remind them to update their primary care designation with insurance if switching PCPs`;
}
// ─── Google OAuth2 Setup ───────────────────────────────────
let oauth2Client = null;
let googleTokens = null;
if (google && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/oauth2callback`
      : 'http://localhost:3000/oauth2callback'
  );
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      googleTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      oauth2Client.setCredentials(googleTokens);
    } catch (e) {}
  }
} else {
  console.log('⚠️  Google Calendar not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env');
}
// ─── ROUTES ────────────────────────────────────────────────
// Chat history

// ─── API Auth Protection ─────────────────────────────────
function apiAuth(req, res, next) {
  // Skip auth for auth routes themselves and static files
  if (req.path.startsWith('/api/auth/')) return next();
  const token = req.headers.authorization?.replace("Bearer ", "") ||
    req.query.token ||
    (req.headers.cookie || "").split(";").map(c => c.trim()).find(c => c.startsWith("ha_token="))?.split("=")[1];
  const session = auth.validateSession(token);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated", redirect: "/login" });
  }
  req.userId = session.userId;
  req.userSession = session;
  next();
}
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  apiAuth(req, res, next);
});

app.get('/api/chat-history', (_req, res) => {
  res.json({ sessions: loadChatHistory() });
});
app.get('/api/chat-history/:id', (req, res) => {
  const data = loadChatHistory();
  const session = data.find((s) => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});
app.delete('/api/chat-history/:id', (req, res) => {
  try {
    const data = { sessions: loadChatHistory() };
    data.sessions = data.sessions.filter((s) => s.id !== req.params.id);
    safeWriteJson(CHAT_HISTORY_FILE, data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/save-chat', (req, res) => {
  try {
    const body = req.body || {};
    const messages = body.messages;
    const patientId = body.patientId;
    if (!messages?.length) return res.json({ success: false });
    const id = saveChatSession(patientId || getCurrentPatientId(), messages);
    res.json({ success: true, id });
  } catch (e) {
    res.json({ success: false });
  }
});
// Notifications
app.get('/api/notifications', (_req, res) => {
  res.json(loadNotifications());
});
app.post('/api/notifications/read/:id', (req, res) => {
  const data = loadNotifications();
  const notif = data.notifications.find((n) => n.id === req.params.id);
  if (notif) notif.read = true;
  saveNotifications(data);
  res.json({ success: true });
});
app.post('/api/notifications/read-all', (_req, res) => {
  const data = loadNotifications();
  data.notifications.forEach((n) => { n.read = true; });
  saveNotifications(data);
  res.json({ success: true });
});
app.delete('/api/notifications/:id', (req, res) => {
  const data = loadNotifications();
  data.notifications = data.notifications.filter((n) => n.id !== req.params.id);
  saveNotifications(data);
  res.json({ success: true });
});
app.post('/api/notifications/add', (req, res) => {
  const { type, title, message, patientId, dueDate } = req.body;
  const notif = addNotification(type, title, message, patientId, dueDate);
  res.json({ success: true, notification: notif });
});
// Patients
app.get('/api/patients', (_req, res) => {
  res.json({ patients: getAllPatients() });
});
app.get('/api/patients/current', (_req, res) => {
  const id = getCurrentPatientId();
  const patients = getAllPatients();
  const patient = patients.find((p) => p.id === id) || patients[0] || null;
  res.json({ patient, currentId: id });
});
app.post('/api/patients/switch', (req, res) => {
  const { patientId } = req.body;
  setCurrentPatientId(patientId);
  conversationHistory = [];
  res.json({ success: true, patientId });
});
app.post('/api/patients/add', (req, res) => {
  try {
    const newPatient = req.body;
    if (!newPatient.id) {
      newPatient.id = `${newPatient.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    }
    const patients = getAllPatients();
    patients.push(newPatient);
    saveAllPatients(patients);
    res.json({ success: true, patient: newPatient });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put('/api/patients/:id', (req, res) => {
  try {
    const patients = getAllPatients();
    const idx = patients.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Patient not found' });
    patients[idx] = { ...patients[idx], ...req.body };
    saveAllPatients(patients);
    res.json({ success: true, patient: patients[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Legacy patient endpoints
app.get('/api/patient', (_req, res) => {
  const currentPatientId = getCurrentPatientId();
  const patients = getAllPatients();
  const patient = patients.find((p) => p.id === currentPatientId) || patients[0] || {};
  res.json(patient);
});
app.get('/api/patient/:id', (req, res) => {
  const patients = getAllPatients();
  const patient = patients.find((p) => p.id === req.params.id);
  res.json(patient || { error: 'not found' });
});
app.put('/api/patient/:id', (req, res) => {
  try {
    const patients = getAllPatients();
    const idx = patients.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Patient not found' });
    patients[idx] = { ...patients[idx], ...req.body };
    saveAllPatients(patients);
    res.json(patients[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Chat ──────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, patientId } = req.body;
  const lower = String(message || '').toLowerCase().trim();
  // confirm patient updates
  if (lower === 'confirm' && pendingUpdates) {
    try {
      const patients = getAllPatients();
      const idx = patients.findIndex((p) => p.id === pendingUpdates.id);
      if (idx >= 0) {
        patients[idx] = { ...patients[idx], ...pendingUpdates.updates };
        saveAllPatients(patients);
      }
      pendingUpdates = null;
      return res.json({ reply: '✅ Patient profile updated successfully!' });
    } catch (e) {
      return res.json({ reply: `❌ Error updating profile: ${e.message}` });
    }
  }
  if ((lower === 'deny' || lower === 'cancel') && pendingUpdates) {
    pendingUpdates = null;
    return res.json({ reply: 'Updates cancelled. No changes were made.' });
  }
  // send email
  if (lower === 'send' && pendingEmailDraft) {
    try {
      await emailTools.sendRealEmail(
        pendingEmailDraft.to,
        pendingEmailDraft.subject,
        pendingEmailDraft.body
      );
      const sentTo = pendingEmailDraft.to;
      pendingEmailDraft = null;
      return res.json({ reply: `✅ **Email sent successfully!** Delivered to ${sentTo}` });
    } catch (e) {
      pendingEmailDraft = null;
      return res.json({ reply: `❌ Failed to send email: ${e.message}` });
    }
  }
  // confirm call
  if (lower === 'confirm call' && pendingCallRequest) {
    try {
      const callResult = await voice.startPhoneCall(
        normalizeUSPhone(pendingCallRequest.phone),
        pendingCallRequest.reason
      );
      const callName = pendingCallRequest.name;
      pendingCallRequest = null;
      return res.json({
        reply: `📞 Calling ${callName} now... Call ID: ${callResult.callId || callResult.id || 'started'}`,
        callId: callResult.callId || callResult.id
      });
    } catch (e) {
      pendingCallRequest = null;
      return res.json({ reply: `❌ Failed to start call: ${e.message}` });
    }
  }
  if (lower === 'cancel call' && pendingCallRequest) {
    pendingCallRequest = null;
    return res.json({ reply: 'Call cancelled.' });
  }
  const currentPatientId = patientId || getCurrentPatientId();
  const patients = getAllPatients();
  const patient = patients.find((p) => p.id === currentPatientId) || patients[0] || {};
  conversationHistory.push({ role: 'user', content: message });
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: buildSystemPrompt(patient),
      messages: conversationHistory
    });
    const reply = response.content?.[0]?.text || 'No response returned.';
    conversationHistory.push({ role: 'assistant', content: reply });
    const emailMatch = reply.match(/EMAIL_DRAFT:(\{[\s\S]*?\})/);
    if (emailMatch) {
      try {
        pendingEmailDraft = JSON.parse(emailMatch[1]);
        emailTools.saveDraft(
          pendingEmailDraft.to,
          pendingEmailDraft.subject,
          pendingEmailDraft.body
        );
      } catch (e) {
        console.log('Email draft parse error:', e.message);
      }
    }
    const callMatch = reply.match(/CALL_REQUEST:(\{[\s\S]*?\})/);
    if (callMatch) {
      try {
        pendingCallRequest = JSON.parse(callMatch[1]);
        if (pendingCallRequest.phone) {
          pendingCallRequest.phone = normalizeUSPhone(pendingCallRequest.phone);
        }
        return res.json({
          reply: reply.replace(/PROVIDER_SEARCH:\{[\s\S]*?\}/,"").replace(/CALL_REQUEST:\{[\s\S]*?\}/, '').trim(),
          callRequest: pendingCallRequest
        });
      } catch (e) {
        console.log('Call request parse error:', e.message);
      }
    }
    const provMatch = reply.match(/PROVIDER_SEARCH:(\{[\s\S]*?\})/);let providerLinks=null;if(provMatch){try{const pData=JSON.parse(provMatch[1]);const{buildProviderSearchURL}=require("./tools/insurance");providerLinks=buildProviderSearchURL(pData.insurance,pData.specialty,pData.location)}catch(e){}}
    const calMatch = reply.match(/CALENDAR_EVENT:(\{[\s\S]*?\})/);
    let calendarEvent = null;
    if (calMatch) {
      try {
        calendarEvent = JSON.parse(calMatch[1]);
      } catch (e) {}
    }
    if (reply.toLowerCase().includes('refill') || reply.toLowerCase().includes('prescription')) {
      addNotification(
        'medication',
        'Medication Refill Reminder',
        `Chat mention: ${String(message).substring(0, 80)}`,
        currentPatientId,
        null
      );
    }
    res.json({
      reply: reply.replace(/PROVIDER_SEARCH:\{[\s\S]*?\}/,"").replace(/CALENDAR_EVENT:\{[\s\S]*?\}/, '').trim(),
      calendarEvent,
      hasPendingEmail: !!pendingEmailDraft,
      hasPendingCall: !!pendingCallRequest,providerLinks
    });
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
// ─── Upload / Vision ───────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const currentPatientId = getCurrentPatientId();
  const patients = getAllPatients();
  const patient = patients.find((p) => p.id === currentPatientId) || patients[0] || {};
  try {
    const filePath = req.file.path;
    const mime = req.file.mimetype;
    let messages = [];
    if (mime.startsWith('image/')) {
      const base64 = fs.readFileSync(filePath).toString('base64');
      messages = [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mime === 'image/jpg' ? 'image/jpeg' : mime,
              data: base64
            }
          },
          {
            type: 'text',
            text:
              'Analyze this medical document image carefully. Read EVERY word, number, and detail visible.\n\n' +
              'DOCUMENT TYPE DETECTION — Identify what this is:\n' +
              '- Insurance card: Extract insurance_company, plan_name, member_name, member_id, group_number, rx_bin, rx_pcn, rx_group, copay_amounts, effective_date, phone_numbers (member services, claims, pharmacy)\n' +
              '- Prescription bottle/label: Extract medication_name, dosage, frequency, quantity, refills_remaining, prescriber, pharmacy_name, pharmacy_phone, rx_number, date_filled, expiration_date, warnings\n' +
              '- Lab results: Extract test_names, values, reference_ranges, abnormal_flags, ordering_doctor, lab_name, date_of_test, patient_name\n' +
              '- Medical bill/EOB: Extract provider_name, date_of_service, total_charge, insurance_paid, patient_responsibility, claim_number, procedure_codes\n' +
              '- Referral/authorization: Extract referring_doctor, specialist, authorization_number, valid_dates, approved_visits\n' +
              '- Other medical document: Extract all visible text and categorize\n\n' +
              'For patient: ' + (patient?.name || 'PATIENT_NAME_HERE') + '\n\n' +
              'Return a JSON object with ALL extracted fields. Format as: EXTRACTED_DATA:{json}\n\n' +
              'Include a "document_type" field (insurance_card, prescription, lab_result, medical_bill, referral, other).\n' +
              'Include a "summary" field explaining what this document is and what actions the caregiver should take.\n' +
              'Include a "confidence" field (high, medium, low) based on image clarity.\n\n' +
              'Be PRECISE with numbers — member IDs, phone numbers, dates, dosages. Do not guess. If you cannot read something clearly, mark it as "unclear" rather than omitting it.'
          }
        ]
      }];
    } else if (mime === 'application/pdf') {
      const pdfBase64 = fs.readFileSync(filePath).toString('base64');
      messages = [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            type: 'text',
            text:
              'Analyze this medical PDF carefully for patient ' + (patient?.name || 'PATIENT_NAME_HERE') + '. ' +
              'Read all visible text. Identify the document type and return structured data as EXTRACTED_DATA:{json}. ' +
              'Include document_type, summary, confidence, and all clearly readable medical, insurance, billing, lab, or prescription details. ' +
              'If text is unreadable or missing, use "unclear" instead of guessing.'
          }
        ]
      }];
    } else {
      let text = '[Could not read file]';
      try {
        text = fs.readFileSync(filePath, 'utf-8').substring(0, 5000);
      } catch (e) {}
      messages = [{
        role: 'user',
        content:
          text +
          '\n\nAnalyze this medical document. Return EXTRACTED_DATA:{json} with document_type, summary, confidence, and all clearly readable fields.'
      }];
    }
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: buildSystemPrompt(patient),
      messages
    });
    const text = response.content?.[0]?.text || '';
    const extracted = extractJsonAfterMarker(text, 'EXTRACTED_DATA:');
    // Timeline event
    try {
      const timelineData = loadTimeline();
      const title = req.file.originalname || 'Uploaded Medical Document';
      const exists = (timelineData.events || []).some((e) =>
        e.title === title && e.patientId === currentPatientId
      );
      if (!exists) {
        timelineData.events = timelineData.events || [];
        timelineData.events.unshift({
          id: Date.now().toString(),
          patientId: currentPatientId,
          date: new Date().toISOString().slice(0, 10),
          title,
          summary: 'Medical document uploaded and analyzed',
          type: 'document',
          source: req.file.originalname || 'upload'
        });
        safeWriteJson(TIMELINE_FILE, timelineData);
      }
    } catch (e) {
      console.log('Timeline save error:', e.message);
    }
    // Task
    try {
      tasksTools.addTask({
        patientId: currentPatientId,
        title: 'Review uploaded document',
        description: `${req.file.originalname || 'Medical document'} was uploaded and may need follow-up.`,
        dueDate: null,
        priority: 'medium',
        category: 'records',
        source: req.file.originalname || 'upload'
      });
    } catch (e) {
      console.log('Task auto-create error:', e.message);
    }
    // Concern
    try {
      let concernTitle = 'Document review pending';
      let concernDescription = `${req.file.originalname || 'Medical document'} was uploaded and may need follow-up.`;
      if (extracted) {
        const docType = String(extracted.document_type || '').toLowerCase();
        if (docType === 'insurance_denial') {
          concernTitle = 'Insurance appeal required';
          concernDescription = 'A denial document was uploaded and may need an appeal or provider follow-up.';
        } else if (docType === 'imaging_order') {
          concernTitle = 'Schedule imaging';
          concernDescription = 'An imaging order was uploaded and may need scheduling.';
        } else if (docType === 'prescription') {
          concernTitle = 'Prescription follow-up';
          concernDescription = 'A prescription document was uploaded and may need refill or medication review.';
        } else if (docType === 'lab_result') {
          concernTitle = 'Review lab results';
          concernDescription = 'A lab result was uploaded and may need provider review.';
        } else if (docType === 'medical_bill') {
          concernTitle = 'Review medical bill';
          concernDescription = 'A medical bill was uploaded and may need billing review.';
        } else if (docType === 'doctor_note') {
          concernTitle = 'Review doctor note';
          concernDescription = 'A doctor note was uploaded and may need follow-up.';
        } else if (docType === 'insurance_card') {
          concernTitle = 'Verify insurance details';
          concernDescription = 'An insurance card was uploaded and coverage details may need verification.';
        } else if (docType === 'referral') {
          concernTitle = 'Referral follow-up';
          concernDescription = 'A referral or authorization was uploaded and may need scheduling or approval review.';
        }
      }
      concernsTools.addConcern({
        patientId: currentPatientId,
        title: concernTitle,
        description: concernDescription,
        priority: 'medium',
        source: req.file.originalname || 'upload'
      });
    } catch (e) {
      console.log('Concern auto-create error:', e.message);
    }
    if (extracted) {
      pendingUpdates = {
        id: currentPatientId,
        updates: extracted,
        raw: text
      };
      // Auto-check Rx status if this is a prescription
      let rxStatus = null;
      let rxPlan = null;
      let priceLinks = null;
      const docType = String(extracted.document_type || '').toLowerCase();
      if (docType === 'prescription' || extracted.medication_name || extracted.rx_number) {
        try {
          rxStatus = rxRefillTools.checkRxStatus(extracted);
          rxPlan = rxRefillTools.buildRefillPlan(extracted, rxStatus, patient);
          const drugName = extracted.medication_name || extracted.drug_name;
          if (drugName) {
            const patientZip = (patient?.address || '').match(/\d{5}/)?.[0] || '78258';
            priceLinks = rxRefillTools.buildPriceCompareLinks(
              drugName,
              extracted.dosage,
              extracted.quantity,
              patientZip
            );
          }
          // Add notification if Rx needs attention
          if (rxStatus && (rxStatus.status === 'expired' || rxStatus.status === 'no_refills')) {
            addNotification(
              'medication',
              `⚠️ Rx Alert: ${extracted.medication_name || 'Medication'}`,
              rxStatus.warnings.join('. '),
              currentPatientId,
              null
            );
          }
        } catch (e) {
          console.log('Rx status check error:', e.message);
        }
      }
      cleanupFile(filePath);
      return res.json({
        success: true,
        extracted,
        message: 'Review the extracted data. Type "confirm" to save or "deny" to cancel.',
        pending: true,
        rxStatus,
        rxPlan,
        priceLinks
      });
    }
    cleanupFile(filePath);
    return res.json({
      success: true,
      message: text || 'Upload processed, but no structured data was returned.',
      pending: false
    });
  } catch (e) {
    cleanupFile(req.file?.path);
    console.error('Upload error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
// ─── Voice Calls ───────────────────────────────────────────
app.post('/api/call', async (req, res) => {
  try {
    const { phone, phoneNumber, reason } = req.body;
    const number = normalizeUSPhone(phone || phoneNumber);
    if (!number) return res.status(400).json({ error: 'Phone number required' });
    const result = await voice.startPhoneCall(number, reason);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/call/:id', async (req, res) => {
  try {
    const status = await voice.getCallStatus(req.params.id);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Email ─────────────────────────────────────────────────
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, body, htmlBody } = req.body;
    const emailBody = htmlBody || body;
    if (to && subject && emailBody) {
      await emailTools.sendRealEmail(to, subject, emailBody);
      return res.json({ success: true, message: 'Email sent successfully!' });
    }
    if (pendingEmailDraft) {
      await emailTools.sendRealEmail(
        pendingEmailDraft.to,
        pendingEmailDraft.subject,
        pendingEmailDraft.body
      );
      const sentTo = pendingEmailDraft.to;
      pendingEmailDraft = null;
      return res.json({ success: true, message: `Email sent successfully to ${sentTo}!` });
    }
    return res.status(400).json({ success: false, error: 'No email payload or pending draft found.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
app.get('/api/drafts', (_req, res) => {
  try {
    const drafts = emailTools.listDrafts();
    res.json({ drafts });
  } catch (e) {
    res.json({ drafts: [] });
  }
});
// ─── Google Calendar OAuth ─────────────────────────────────
app.get('/auth/google', (_req, res) => {
  if (!oauth2Client) {
    return res.send('<h2>Google Calendar not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env</h2>');
  }
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    prompt: 'consent'
  });
  res.redirect(url);
});
app.get('/oauth2callback', async (req, res) => {
  if (!oauth2Client) return res.status(500).send('Google Calendar not configured');
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    googleTokens = tokens;
    oauth2Client.setCredentials(tokens);
    safeWriteJson(TOKEN_FILE, tokens);
    res.send(
      '<html><body style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h2>✅ Google Calendar Connected!</h2>' +
      '<p>You can now add events from the chat.</p>' +
      '<script>setTimeout(() => window.close(), 2000)</script>' +
      '</body></html>'
    );
  } catch (e) {
    res.status(500).send(`Error: ${e.message}`);
  }
});
app.get('/api/calendar/status', (_req, res) => {
  res.json({ connected: !!googleTokens });
});
app.post('/api/calendar/add-event', async (req, res) => {
  if (!googleTokens || !oauth2Client) {
    return res.status(401).json({ error: 'Google Calendar not connected. Visit /auth/google first.' });
  }
  try {
    const { title, date, time, duration, description } = req.body;
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const startDateTime = new Date(`${date}T${time || '09:00'}:00`);
    const endDateTime = new Date(startDateTime.getTime() + (duration || 60) * 60000);
    const event = {
      summary: title,
      description: description || '',
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Chicago' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Chicago' }
    };
    const result = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });
    addNotification(
      'appointment',
      `Appointment Added: ${title}`,
      `Added to Google Calendar: ${date} at ${time || '9:00 AM'}`,
      getCurrentPatientId(),
      date
    );
    res.json({
      success: true,
      eventId: result.data.id,
      link: result.data.htmlLink
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/calendar/events', (_req, res) => {
  try {
    const events = calendarTools.listEvents ? calendarTools.listEvents() : [];
    res.json({ events });
  } catch (e) {
    res.json({ events: [] });
  }
});
app.get('/api/calendar/ics', (req, res) => {
  try {
    const { title, date, time, duration, description } = req.query;
    if (!title || !date) return res.status(400).send('Missing title or date');
    const start = new Date(`${date}T${time || '09:00'}:00`);
    const end = new Date(start.getTime() + (Number(duration || 60) * 60000));
    function formatICSDate(d) {
      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    }
    const safeTitle = String(title).replace(/\n/g, ' ').trim();
    const safeDescription = String(description || '').replace(/\n/g, ' ').trim();
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Health Agent//EN',
      'BEGIN:VEVENT',
      `SUMMARY:${safeTitle}`,
      `DESCRIPTION:${safeDescription}`,
      `DTSTART:${formatICSDate(start)}`,
      `DTEND:${formatICSDate(end)}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=event.ics');
    res.send(ics);
  } catch (e) {
    res.status(500).send(e.message);
  }
});
// ─── Medications API ──────────────────────────────────────
app.get('/api/medications', (req, res) => {
  try {
    const meds = medicationsTools.getMedications ? medicationsTools.getMedications() : [];
    res.json({ medications: meds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/medications/check-interactions', (req, res) => {
  try {
    const { medications } = req.body;
    let medNames = medications;
    // If no meds passed, use current patient's meds
    if (!medNames || !medNames.length) {
      const patientId = getCurrentPatientId();
      const patients = getAllPatients();
      const patient = patients.find(p => p.id === patientId) || patients[0];
      medNames = (patient?.medications || []).map(m => m.name).filter(Boolean);
    }
    if (!medNames || medNames.length < 2) {
      return res.json({ interactions: [], message: 'Need at least 2 medications to check interactions.' });
    }
    const interactions = medicationsTools.checkInteractions(medNames);
    res.json({
      interactions,
      checked: medNames,
      count: interactions.length,
      message: interactions.length > 0
        ? `Found ${interactions.length} potential interaction(s). Review with your healthcare provider.`
        : 'No known interactions found between these medications.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/medications/refills', (req, res) => {
  try {
    const days = parseInt(req.query.days || '7', 10);
    const meds = medicationsTools.getMedsNeedingRefill(days);
    res.json({ medications: meds, daysAhead: days });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Tasks API ─────────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
  try {
    const patientId = req.query.patientId || getCurrentPatientId();
    const tasks = tasksTools.listTasks(patientId);
    res.json({ tasks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/tasks', (req, res) => {
  try {
    const patientId = req.body.patientId || getCurrentPatientId();
    const task = tasksTools.addTask({
      ...req.body,
      patientId
    });
    res.json({ success: true, task });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/tasks/add', (req, res) => {
  try {
    const patientId = req.body.patientId || getCurrentPatientId();
    const task = tasksTools.addTask({
      ...req.body,
      patientId
    });
    res.json({ success: true, task });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put('/api/tasks/:id', (req, res) => {
  try {
    const task = tasksTools.updateTask(req.params.id, req.body);
    res.json({ success: true, task });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/tasks/:id', (req, res) => {
  try {
    const deleted = tasksTools.deleteTask
      ? tasksTools.deleteTask(req.params.id)
      : true;
    res.json({ success: true, deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/tasks/:id/complete', (req, res) => {
  try {
    const task = tasksTools.updateTask(req.params.id, {
      status: 'done',
      completedAt: new Date().toISOString()
    });
    res.json({ success: true, task });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Timeline API ──────────────────────────────────────────
app.get('/api/timeline', (_req, res) => {
  try {
    const patientId = getCurrentPatientId();
    const data = loadTimeline();
    const events = (data.events || []).filter((e) => e.patientId === patientId || !e.patientId);
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Brief API ─────────────────────────────────────────────
app.get('/api/brief', (_req, res) => {
  try {
    const patientId = getCurrentPatientId();
    const patients = getAllPatients();
    const patient = patients.find((p) => p.id === patientId) || patients[0] || {};
    const timeline = loadTimeline();
    const recentTimeline = (timeline.events || [])
      .filter((e) => e.patientId === patientId || !e.patientId)
      .slice(0, 10);
    const openTasks = tasksTools.listTasks(patientId).filter((t) => t.status !== 'done');
    res.json({
      patient,
      recentTimeline,
      openTasks
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Dashboard ─────────────────────────────────────────────
app.get('/api/dashboard', (_req, res) => {
  const patient = getAllPatients().find((p) => p.id === getCurrentPatientId());
  res.json({
    patient,
    appointments: appointmentsTools.listUpcoming ? appointmentsTools.listUpcoming() : [],
    medications: medicationsTools.getMedications ? medicationsTools.getMedications() : [],
    drafts: emailTools.listDrafts(),
    notifications: loadNotifications()
  });
});
// ─── Active Concerns ───────────────────────────────────────
app.get('/api/concerns', (_req, res) => {
  try {
    const patientId = getCurrentPatientId();
    const concerns = concernsTools.listConcerns(patientId);
    res.json({ concerns });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/concerns/add', (req, res) => {
  try {
    const patientId = req.body.patientId || getCurrentPatientId();
    const concern = concernsTools.addConcern({
      ...req.body,
      patientId
    });
    res.json({ success: true, concern });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/concerns/resolve/:id', (req, res) => {
  try {
    const updated = concernsTools.resolveConcern(req.params.id);
    res.json({ success: true, concern: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/pending', (_req, res) => {
  res.json(pendingUpdates);
});
// ─── Medication Interaction Check ────────────────────────
app.post('/api/medications/check-interactions', (req, res) => {
  try {
    const { medications } = req.body;
    if (!medications || !Array.isArray(medications) || medications.length === 0) {
      const patient = getAllPatients().find(p => p.id === getCurrentPatientId());
      const medNames = (patient?.medications || []).map(m => m.name);
      const interactions = medicationsTools.checkInteractions(medNames);
      return res.json({ interactions, medications: medNames });
    }
    const interactions = medicationsTools.checkInteractions(medications);
    res.json({ interactions, medications });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/medications', (_req, res) => {
  try {
    const patient = getAllPatients().find(p => p.id === getCurrentPatientId());
    const meds = patient?.medications || [];
    const refillsSoon = medicationsTools.getMedsNeedingRefill(7);
    const interactions = medicationsTools.checkInteractions(meds.map(m => m.name));
    res.json({ medications: meds, refillsSoon, interactions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Rx Refill & Price Comparison ────────────────────────
app.post('/api/rx/check-status', (req, res) => {
  try {
    const { rxData } = req.body;
    const status = rxRefillTools.checkRxStatus(rxData || {});
    const patient = getAllPatients().find(p => p.id === getCurrentPatientId());
    const plan = rxRefillTools.buildRefillPlan(rxData || {}, status, patient);
    res.json({ status, plan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/rx/price-compare', (req, res) => {
  try {
    const { drugName, dosage, quantity, zipCode } = req.body;
    if (!drugName) return res.status(400).json({ error: 'Drug name required' });
    const patient = getAllPatients().find(p => p.id === getCurrentPatientId());
    // Try to extract zip from patient address
    const patientZip = (patient?.address || '').match(/\d{5}/)?.[0] || '78258';
    const links = rxRefillTools.buildPriceCompareLinks(
      drugName,
      dosage,
      quantity,
      zipCode || patientZip
    );
    // Include insurance info for comparison context
    const insurance = patient?.insurance || {};
    res.json({
      drugName,
      dosage,
      quantity,
      links,
      insurance: {
        primary: insurance.primary || null,
        memberId: insurance.memberId || null
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Insurance Matcher ──────────────────────────────────
const insuranceMatcher = require("./tools/insurance-matcher");
app.post("/api/insurance/match", (req, res) => {
  try {
    const profile = req.body;
    const results = insuranceMatcher.matchInsurance(profile);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/insurance/match-current", (_req, res) => {
  try {
    const patients = getAllPatients();
    const patient = patients.find(p => p.id === getCurrentPatientId()) || patients[0] || {};
    const age = null;
    if (patient.dob) {
      try {
        const parts = patient.dob.split("/");
        if (parts.length === 3) {
          const born = new Date(parts[2] + "-" + parts[0].padStart(2,"0") + "-" + parts[1].padStart(2,"0"));
          if (!isNaN(born.getTime())) {
            const ageDiff = Date.now() - born.getTime();
            const ageDate = new Date(ageDiff);
            var calcAge = Math.abs(ageDate.getUTCFullYear() - 1970);
          }
        }
      } catch(e) {}
    }
    const profile = {
      age: calcAge || null,
      state: (patient.address || "").match(/[A-Z]{2}\s*\d{5}/)?.[0]?.substring(0,2) || "TX",
      familySize: 1,
      annualIncome: null
    };
    const results = insuranceMatcher.matchInsurance(profile);
    res.json({ patient: patient.name, ...results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Auth System ─────────────────────────────────────────
const auth = require("./tools/auth");
app.get("/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    const user = await auth.registerUser({ email, password, name });
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await auth.loginWithPassword(email, password);
    res.json(result);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});
app.get("/api/auth/verify", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const session = auth.validateSession(token);
  if (!session) return res.status(401).json({ error: "Invalid session" });
  res.json({ valid: true, session });
});
app.post("/api/auth/logout", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  auth.logout(token);
  res.json({ success: true });
});
app.get("/api/auth/biometric-challenge", (_req, res) => {
  const crypto = require("crypto");
  const challenge = crypto.randomBytes(32).toString("base64");
  res.json({ challenge });
});
app.post("/api/auth/biometric-login", (req, res) => {
  try {
    const { credentialId } = req.body;
    const result = auth.loginWithBiometric(credentialId);
    res.json(result);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});
app.post("/api/auth/biometric-register", (req, res) => {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const session = auth.validateSession(token);
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    const { credentialId } = req.body;
    auth.registerBiometric(session.userId, credentialId);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});


// ─── Lab Analyzer ────────────────────────────────────────
const labAnalyzer = require("./tools/lab-analyzer");
app.post("/api/labs/analyze", (req, res) => {
  try {
    const { labData, patientId, labDate } = req.body;
    const analysis = labAnalyzer.analyzeLabResults(labData);
    const pid = patientId || getCurrentPatientId();
    if (labData) labAnalyzer.saveLabToHistory(pid, labDate, labData, analysis);
    res.json(analysis);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/labs/trends", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const trends = labAnalyzer.compareLabTrends(pid);
    res.json(trends);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Symptom-Med Correlator ──────────────────────────────
const symptomTracker = require("./tools/symptom-tracker");
app.post("/api/symptoms/log", (req, res) => {
  try {
    const { symptom, severity, notes, patientId } = req.body;
    const entry = symptomTracker.logSymptom(patientId || getCurrentPatientId(), symptom, severity, notes);
    res.json({ success: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/meds/log-change", (req, res) => {
  try {
    const { medication, changeType, oldDose, newDose, reason, prescriber, patientId } = req.body;
    const entry = symptomTracker.logMedChange(patientId || getCurrentPatientId(), medication, changeType, oldDose, newDose, reason, prescriber);
    res.json({ success: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/correlations", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const report = symptomTracker.generateCorrelationReport(pid);
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/symptoms/timeline", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const days = parseInt(req.query.days) || 90;
    const timeline = symptomTracker.getSymptomTimeline(pid, days);
    res.json({ timeline });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Living Medical Summary ──────────────────────────────
const medSummary = require("./tools/medical-summary");
app.get("/api/summary/full", (req, res) => {
  try {
    const patients = getAllPatients();
    const patient = patients.find(p => p.id === getCurrentPatientId()) || patients[0] || {};
    const summary = medSummary.buildMedicalSummary(patient);
    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/summary/text", (req, res) => {
  try {
    const patients = getAllPatients();
    const patient = patients.find(p => p.id === getCurrentPatientId()) || patients[0] || {};
    const summary = medSummary.buildMedicalSummary(patient);
    const text = medSummary.formatSummaryAsText(summary);
    res.setHeader("Content-Type", "text/plain");
    res.send(text);
  } catch (e) { res.status(500).send("Error: " + e.message); }
});

// ─── Static pages ──────────────────────────────────────────
app.get('/', (req, res) => {
  const token = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('ha_token='));
  const session = token ? auth.validateSession(token.split('=')[1]) : null;
  if (!session) {
    return res.redirect('/login');
  }
  // Auto-redirect to onboarding if no patients exist
  const patients = getAllPatients();
  if (!patients || patients.length === 0) {
    return res.redirect('/onboarding');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/onboarding', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});
app.get('/settings', (_req, res) => {
  const settingsPath = path.join(__dirname, 'public', 'settings.html');
  if (fs.existsSync(settingsPath)) res.sendFile(settingsPath);
  else res.redirect('/');
});
app.get('/timeline', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'timeline.html'));
});
app.get('/tasks', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tasks.html'));
});
app.get('/brief', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'brief.html'));
});
app.get('/playbooks', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'playbooks.html'));
});
// ─── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏥 Health Agent running on http://localhost:${PORT}`);
  console.log(`📅 Google Calendar: ${googleTokens ? '✅ Connected' : '⚠️  Not connected — visit /auth/google'}`);
  console.log(`🔔 Notifications: ${NOTIFICATIONS_FILE}`);
  console.log(`💬 Chat history: ${CHAT_HISTORY_FILE}\n`);
});
// === Lead Pipeline & Verification Routes ===


