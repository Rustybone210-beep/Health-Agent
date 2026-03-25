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
const { ensureDataFiles } = require("./init-data");
ensureDataFiles();
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

function processMultiDocExtraction(extracted, text) {
  // If the extraction contains a "documents" array, return all of them
  if (extracted && extracted.documents && Array.isArray(extracted.documents)) {
    return extracted.documents;
  }
  // Otherwise return as single document in an array
  return [extracted];
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
function getAllPatientsRaw() {
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

function getAllPatients(userId) {
  const all = getAllPatientsRaw();
  if (!userId) return all;
  return all.filter(p => !p.ownerId || p.ownerId === userId);
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
  return `You are Health Agent — an elite AI healthcare navigator with the analytical depth of a medical detective. You connect dots across medications, labs, symptoms, hormones, and specialists that doctors miss.

CORE RULES:
1. PROACTIVE PATTERN DETECTION - When a user mentions a symptom, check if connected to recent medication changes, lab abnormalities, or hormonal shifts.
2. CROSS-SYSTEM THINKING - Thyroid affects cholesterol, weight, AND eyes. Cholesterol affects serum tears. Hormones affect meibomian glands. Always connect.
3. MED-SYMPTOM CORRELATION - When any medication changes, flag what symptoms to watch and what timeline to expect.
4. LAB INTELLIGENCE - When labs uploaded, explain what they mean for THIS patient given their conditions and medications.
5. NEVER DISMISS - If patient reports symptoms and doctor says labs look fine, advocate for the patient.
6. SERUM TEAR AWARENESS - If patient uses serum tears AND has high cholesterol or inflammatory markers, FLAG that blood chemistry affects tear composition.
7. SPECIALIST COORDINATION - Explain WHY each specialist fits, what to tell them, what questions to ask.
8. INSURANCE NAVIGATION - Know Medicare vs Medicaid vs Medicare Advantage vs supplements.
9. MEDICATION EXPERTISE - Know interactions, side effects, timing. Know reducing Synthroid can cause weight gain and worsen dry eye.
10. SCAN INTELLIGENCE - Extract EVERY detail from documents. Two cards in one photo means get BOTH.
11. PLAIN LANGUAGE - Explain medical terms in plain English first.
12. CAREGIVER EMPATHY - Acknowledge the caregiver effort. Be their advocate.
13. TIMELINE AWARENESS - When symptoms worsen, ask WHEN and what changed around that time.
14. COST AWARENESS - Suggest generics, GoodRx, Cost Plus Drugs, patient assistance programs.
15. SECOND OPINION READINESS - If treatment has failed, suggest specialist or second opinion with a printable summary.
16. PREDICTIVE THINKING - Anticipate upcoming needs, lab checks, appointment prep.
17. DOCUMENT EVERYTHING - Build the medical timeline that tells the full story.

You are Health Agent — an AI healthcare navigator and caregiver command center. You help manage healthcare for patients and their families.
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
app.get('/api/patients', (req, res) => {
  try {
    const userId = req.userSession?.userId || null;
    const allRaw = typeof getAllPatientsUnfiltered === 'function' ? getAllPatientsUnfiltered() : getAllPatients();
    const patients = userId ? allRaw.filter(p => !p.ownerId || p.ownerId === userId) : allRaw;
    res.json({ patients });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/patients/current', (req, res) => {
  try {
    const userId = req.userSession?.userId || null;
    const allRaw = typeof getAllPatientsUnfiltered === 'function' ? getAllPatientsUnfiltered() : getAllPatients();
    const patients = userId ? allRaw.filter(p => !p.ownerId || p.ownerId === userId) : allRaw;
    const currentId = getCurrentPatientId();
    const current = patients.find(p => p.id === currentId) || patients[0] || null;
    res.json({ currentId: current?.id || null, patient: current });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    if (req.userSession) newPatient.ownerId = req.userSession.userId;
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
              'CRITICAL: First, count how many SEPARATE documents, cards, or papers are visible in this image. If you see MORE THAN ONE document (for example two insurance cards side by side, or front and back of a card, or a card next to a prescription), you MUST extract data from EACH document separately and return them in a documents array. This is essential — do not skip any visible document. There may be MULTIPLE documents in this image (e.g. front and back of a card, or two different cards side by side). Read EVERY word, number, and detail visible on ALL documents. If you see multiple documents, return ALL of them in your response. For example, if you see a Medicare card AND an Aetna card, extract data from BOTH and include them as separate objects in your response.\n\n' +
              'DOCUMENT TYPE DETECTION — Identify what this is:\n' +
              '- Insurance card: Extract insurance_company, plan_name, member_name, member_id, group_number, rx_bin, rx_pcn, rx_group, copay_amounts, effective_date, phone_numbers (member services, claims, pharmacy)\n' +
              '- Prescription bottle/label: Extract medication_name, dosage, frequency, quantity, refills_remaining, prescriber, pharmacy_name, pharmacy_phone, rx_number, date_filled, expiration_date, warnings\n' +
              '- Lab results: Extract test_names, values, reference_ranges, abnormal_flags, ordering_doctor, lab_name, date_of_test, patient_name\n' +
              '- Medical bill/EOB: Extract provider_name, date_of_service, total_charge, insurance_paid, patient_responsibility, claim_number, procedure_codes\n' +
              '- Referral/authorization: Extract referring_doctor, specialist, authorization_number, valid_dates, approved_visits\n' +
              '- Other medical document: Extract all visible text and categorize\n\n' +
              'For patient: ' + (patient?.name || 'PATIENT_NAME_HERE') + '\n\n' +
              'Return a JSON object with ALL extracted fields. Format as: EXTRACTED_DATA:{json}\n\n' +
              'IMPORTANT: If multiple documents are visible, return ALL of them as: EXTRACTED_DATA:{"documents":[{...first...},{...second...}]} with each having its own document_type, summary, and fields. If only one document, return normally. Include a "document_type" field (insurance_card, prescription, lab_result, medical_bill, referral, other).\n' +
              'If you see MULTIPLE documents in the image (e.g. two insurance cards, or front and back), return them as:\n' +
              'EXTRACTED_DATA:{"documents":[{...first document...},{...second document...}]}\n' +
              'Each document should have its own document_type, summary, confidence, and all relevant fields.\n' +
              'If there is only one document, still return it as: EXTRACTED_DATA:{...single document fields...}\n' +
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

// ─── Forgot Password ────────────────────────────────────
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const reset = auth.createPasswordReset(email);
    const resetUrl = (process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "http://localhost:" + (process.env.PORT || 3000))) + "/reset-password?token=" + reset.token;
    try {
      if (process.env.RESEND_API_KEY) {
        const { Resend } = require("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.FROM_EMAIL || "Health Agent <onboarding@resend.dev>",
          to: email,
          subject: "Reset Your Health Agent Password",
          html: "<h2>Password Reset</h2><p>Click below to reset your password (expires in 1 hour):</p><p><a href='" + resetUrl + "' style='display:inline-block;padding:12px 24px;background:#2dd4bf;color:#0f172a;border-radius:12px;text-decoration:none;font-weight:bold'>Reset Password</a></p>"
        });
      }
    } catch(emailErr) { console.log("Reset email error:", emailErr.message); }
    res.json({ success: true, message: "If that email exists, a reset link has been sent.", resetUrl: process.env.NODE_ENV !== "production" ? resetUrl : undefined });
  } catch (e) {
    res.json({ success: true, message: "If that email exists, a reset link has been sent." });
  }
});
app.post("/api/auth/reset-password", (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: "Token and password required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    auth.resetPassword(token, password);
    res.json({ success: true, message: "Password reset. You can now sign in." });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get("/reset-password", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "reset-password.html"));
});
app.post("/api/auth/welcome-email", async (req, res) => {
  try {
    const { email, name } = req.body;
    if (process.env.RESEND_API_KEY) {
      const { Resend } = require("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.FROM_EMAIL || "Health Agent <onboarding@resend.dev>",
        to: email,
        subject: "Welcome to Health Agent",
        html: "<h2 style='color:#2dd4bf'>Welcome to Health Agent!</h2><p>Hi " + (name || "there") + ",</p><p>Your account is ready. Start by scanning your first document or asking the AI a question.</p>"
      });
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: true }); }
});

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


// ─── Medication Reminders ────────────────────────────────
const medReminders = require("./tools/med-reminders");
const cron = require("node-cron");

app.get("/api/reminders", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const reminders = medReminders.getReminders(pid);
    const stats = medReminders.getAdherenceStats(pid, 30);
    res.json({ reminders, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/reminders/create", (req, res) => {
  try {
    const r = medReminders.createReminder(req.body);
    res.json({ success: true, reminder: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/reminders/auto-create", (req, res) => {
  try {
    const patients = getAllPatients();
    const patient = patients.find(p => p.id === (req.body.patientId || getCurrentPatientId()));
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const created = medReminders.autoCreateFromPatient(patient);
    res.json({ success: true, created: created.length, reminders: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/reminders/:id/taken", (req, res) => {
  try {
    const r = medReminders.confirmTaken(req.params.id);
    res.json({ success: true, reminder: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/reminders/:id/skipped", (req, res) => {
  try {
    const r = medReminders.confirmSkipped(req.params.id, req.body.reason);
    res.json({ success: true, reminder: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/reminders/:id", (req, res) => {
  try {
    medReminders.deleteReminder(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/reminders/due", (_req, res) => {
  try {
    const due = medReminders.getDueReminders();
    res.json({ due });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Check reminders every minute
cron.schedule("* * * * *", () => {
  try {
    const due = medReminders.getDueReminders();
    due.forEach(r => {
      addNotification("medication", "Time for " + r.medication, r.dose + " — tap to confirm taken", r.patientId, null);
      medReminders.markTriggered(r.id);
    });
  } catch (e) { console.log("Reminder cron error:", e.message); }
});

// ─── HIPAA Audit Logging ─────────────────────────────────
const auditLog = require("./tools/audit-log");
app.use(auditLog.auditMiddleware);

app.get("/api/audit-log", (req, res) => {
  try {
    const filters = {
      userId: req.query.userId,
      patientId: req.query.patientId,
      action: req.query.action,
      since: req.query.since,
      limit: parseInt(req.query.limit) || 100,
      phi_only: req.query.phi === "true"
    };
    const logs = auditLog.getAuditLog(filters);
    res.json({ logs, count: logs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Payments ────────────────────────────────────────────
const payments = require("./tools/payments");

app.get("/pricing", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "pricing.html"));
});
app.post("/api/payments/checkout", async (req, res) => {
  try {
    const { tier, interval } = req.body;
    const session = req.userSession;
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    if (!payments.stripe) return res.json({ error: "Stripe not configured. Add STRIPE_SECRET_KEY to .env" });
    const checkout = await payments.createCheckoutSession(session.userId, session.email, tier, interval);
    res.json({ url: checkout.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const result = await payments.handleWebhook(req.body, sig);
    if (result.action === "upgrade" && result.userId) {
      const authMod = require("./tools/auth");
      authMod.updateUserTier(result.userId, result.tier);
    }
    res.json({ received: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Caregiver Sharing ───────────────────────────────────
const sharing = require("./tools/sharing");

app.post("/api/sharing/invite", (req, res) => {
  try {
    const session = req.userSession;
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    const { patientId, patientName, permission } = req.body;
    const invite = sharing.createInvite(session.userId, session.email, patientId, patientName, permission);
    const inviteUrl = (process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "http://localhost:" + (process.env.PORT || 3000))) + "/invite/" + invite.code;
    res.json({ success: true, invite, inviteUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/sharing/accept", (req, res) => {
  try {
    const session = req.userSession;
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    const { code } = req.body;
    const share = sharing.acceptInvite(code, session.userId, session.email);
    res.json({ success: true, share });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/sharing/my-shares", (req, res) => {
  try {
    const session = req.userSession;
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    const shared = sharing.getSharedPatients(session.userId);
    res.json({ shares: shared });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/sharing/patient/:patientId", (req, res) => {
  try {
    const shares = sharing.getSharesForPatient(req.params.patientId);
    res.json({ shares });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/sharing/:shareId", (req, res) => {
  try {
    const session = req.userSession;
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    const share = sharing.revokeShare(req.params.shareId, session.userId);
    res.json({ success: true, share });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/invite/:code", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ─── Database Backup ─────────────────────────────────────
const dbBackup = require("./tools/db-backup");

// Auto-backup every 6 hours
cron.schedule("0 */6 * * *", () => {
  try {
    const result = dbBackup.createBackup();
    console.log("Auto-backup created:", result.files, "files");
  } catch (e) { console.log("Backup error:", e.message); }
});

app.post("/api/backup/create", (_req, res) => {
  try {
    const result = dbBackup.createBackup();
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/backup/list", (_req, res) => {
  try {
    const backups = dbBackup.listBackups();
    res.json({ backups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// ─── Lab Trends & Charts ────────────────────────────────
const labTrends = require("./tools/lab-trends");
app.get("/api/labs/chart", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const tests = req.query.tests ? req.query.tests.split(",") : ["Total Cholesterol", "LDL", "HDL"];
    const data = labTrends.getChartData(pid, tests);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/labs/all-trends", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const trends = labTrends.getAllTrends(pid);
    res.json({ trends });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Health Device Data ──────────────────────────────────
const healthData = require("./tools/health-data");
app.post("/api/health/record", (req, res) => {
  try {
    const { metric, value, source, timestamp, patientId } = req.body;
    const entry = healthData.recordReading(patientId || getCurrentPatientId(), metric, value, source, timestamp);
    const alerts = healthData.checkAlerts(patientId || getCurrentPatientId());
    if (alerts.length > 0) {
      alerts.forEach(a => addNotification("medication", "⚠️ " + a.metric, a.message, patientId || getCurrentPatientId(), null));
    }
    res.json({ success: true, entry, alerts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/health/import", (req, res) => {
  try {
    const { readings, source, patientId } = req.body;
    const imported = healthData.bulkImport(patientId || getCurrentPatientId(), readings, source);
    res.json({ success: true, imported: imported.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/health/vitals", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const latest = healthData.getLatestVitals(pid);
    const alerts = healthData.checkAlerts(pid);
    res.json({ vitals: latest, alerts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/health/chart", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const metric = req.query.metric || "blood_pressure_systolic";
    const days = parseInt(req.query.days) || 30;
    const chart = healthData.getVitalsChartData(pid, metric, days);
    res.json(chart);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/health/metrics", (_req, res) => {
  res.json({ metrics: healthData.SUPPORTED_METRICS });
});

// ─── Appointment Booking ─────────────────────────────────
const apptBooking = require("./tools/appointments-booking");
app.post("/api/appointments/create", (req, res) => {
  try {
    const appt = apptBooking.createAppointment(req.body);
    const patient = getAllPatients().find(p => p.id === (req.body.patientId || getCurrentPatientId()));
    const checklist = apptBooking.generatePrepChecklist(appt, patient);
    checklist.forEach(item => apptBooking.addPrepItem(appt.id, item));
    addNotification("appointment", "Appointment: " + appt.doctorName, appt.date + " at " + appt.time, appt.patientId, appt.date);
    res.json({ success: true, appointment: appt, checklist });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/appointments/upcoming", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const appts = apptBooking.getUpcoming(pid, parseInt(req.query.days) || 90);
    res.json({ appointments: appts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/appointments/past", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const appts = apptBooking.getPast(pid, parseInt(req.query.days) || 365);
    res.json({ appointments: appts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/appointments/:id", (req, res) => {
  try {
    const appt = apptBooking.updateAppointment(req.params.id, req.body);
    res.json({ success: true, appointment: appt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/appointments/:id/cancel", (req, res) => {
  try {
    const appt = apptBooking.cancelAppointment(req.params.id, req.body.reason);
    res.json({ success: true, appointment: appt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/appointments/:id/question", (req, res) => {
  try {
    const appt = apptBooking.addQuestion(req.params.id, req.body.question);
    res.json({ success: true, appointment: appt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/appointments/today", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const appts = apptBooking.getTodaysAppointments(pid);
    res.json({ appointments: appts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Medical Translation ────────────────────────────────
const translator = require("./tools/medical-translator");
app.post("/api/translate", (req, res) => {
  try {
    const { text, term } = req.body;
    if (term) {
      const result = translator.translateTerm(term);
      res.json({ term, translation: result });
    } else if (text) {
      const result = translator.translateText(text);
      res.json(result);
    } else {
      res.status(400).json({ error: "Provide text or term" });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/translate/dictionary", (_req, res) => {
  try {
    const dict = translator.getFullDictionary();
    res.json({ terms: dict, count: dict.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Transportation ──────────────────────────────────────
const transport = require("./tools/transportation");
app.post("/api/transport/request", (req, res) => {
  try {
    const ride = transport.requestRide(req.body);
    res.json({ success: true, ride });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/transport/links", (req, res) => {
  try {
    const links = transport.buildRideLinks(req.query.pickup, req.query.destination);
    res.json({ links });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/transport/for-appointment/:apptId", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid);
    const appts = apptBooking.getUpcoming(pid, 365);
    const appt = appts.find(a => a.id === req.params.apptId);
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    const result = transport.buildTransportForAppointment(appt, patient?.address);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Pharmacy Refills ────────────────────────────────────
const pharmacy = require("./tools/pharmacy");
app.post("/api/pharmacy/refill", (req, res) => {
  try {
    const request = pharmacy.createRefillRequest(req.body);
    addNotification("medication", "Refill Requested: " + request.medication, "Status: " + request.status, request.patientId, null);
    res.json({ success: true, refill: request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/pharmacy/pending", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const pending = pharmacy.getPendingRefills(pid);
    res.json({ refills: pending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/pharmacy/history", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const history = pharmacy.getRefillHistory(pid);
    res.json({ refills: history });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/pharmacy/refill/:id", (req, res) => {
  try {
    const refill = pharmacy.updateRefillStatus(req.params.id, req.body.status, req.body.notes);
    res.json({ success: true, refill });
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// ─── Clinical Trial Matching ─────────────────────────────
const clinicalTrials = require("./tools/clinical-trials");
app.get("/api/trials/search", async (req, res) => {
  try {
    const results = await clinicalTrials.searchTrials({
      condition: req.query.condition,
      location: req.query.location || "San Antonio, TX",
      age: req.query.age,
      gender: req.query.gender,
      limit: parseInt(req.query.limit) || 10
    });
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/trials/match", async (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const results = await clinicalTrials.matchTrialsForPatient(patient);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/trials/save", (req, res) => {
  try {
    const { patientId, trial, notes } = req.body;
    const result = clinicalTrials.saveTrial(patientId || getCurrentPatientId(), trial, notes);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/trials/saved", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const saved = clinicalTrials.getSavedTrials(pid);
    res.json({ trials: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Predictive Health Alerts ────────────────────────────
const predictive = require("./tools/predictive-alerts");
app.get("/api/alerts/predictive", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid);
    const symptomTracker = require("./tools/symptom-tracker");
    const labAnalyzer = require("./tools/lab-analyzer");
    const medReminders = require("./tools/med-reminders");
    let labHistory = [];
    try { labHistory = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "lab_history.json"), "utf8")).filter(l => l.patientId === pid); } catch(e){}
    let symptoms = [];
    try { symptoms = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "symptom_log.json"), "utf8")).filter(s => s.patientId === pid); } catch(e){}
    let medChanges = [];
    try { medChanges = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "med_changes.json"), "utf8")).filter(m => m.patientId === pid); } catch(e){}
    const correlations = symptomTracker.findCorrelations(pid, 60);
    const adherence = medReminders.getAdherenceStats(pid, 14);
    const patientData = {
      symptoms,
      medChanges,
      labs: labHistory,
      medications: patient?.medications || [],
      correlations,
      adherence,
      vitals: {},
      appointments: []
    };
    const alerts = predictive.runPredictiveAnalysis(patientData);
    predictive.saveAlerts(pid, alerts);
    res.json({ alerts, count: alerts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/alerts/active", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const alerts = predictive.getAlerts(pid);
    res.json({ alerts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/alerts/:alertId/dismiss", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    predictive.dismissAlert(pid, req.params.alertId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Mental Health Screening ─────────────────────────────
const mentalHealth = require("./tools/mental-health");
app.get("/api/screening/available", (_req, res) => {
  try {
    const screenings = mentalHealth.getAvailableScreenings();
    res.json({ screenings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/screening/:type", (req, res) => {
  try {
    const screening = mentalHealth.getScreening(req.params.type);
    if (!screening) return res.status(404).json({ error: "Screening not found" });
    res.json({ name: screening.name, description: screening.description, questions: screening.questions, options: screening.options });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/screening/:type/score", (req, res) => {
  try {
    const { answers, patientId } = req.body;
    const result = mentalHealth.scoreScreening(req.params.type, answers);
    const pid = patientId || getCurrentPatientId();
    mentalHealth.saveScreeningResult(pid, req.userSession?.userId, result);
    if (result.severity === "severe" || result.severity === "high") {
      addNotification("medication", "⚠️ " + result.name, result.severity + " — " + result.recommendation, pid, null);
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/screening/history/:patientId", (req, res) => {
  try {
    const history = mentalHealth.getScreeningHistory(req.params.patientId, req.query.type);
    res.json({ history });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Advance Directives ─────────────────────────────────
const directives = require("./tools/advance-directives");
app.get("/api/directives/types", (_req, res) => {
  try {
    const types = directives.getDocumentTypes();
    res.json({ types });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/directives/create", (req, res) => {
  try {
    const { patientId, type, data } = req.body;
    const directive = directives.createDirective(patientId || getCurrentPatientId(), type, data);
    res.json({ success: true, directive });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/directives/:id", (req, res) => {
  try {
    const directive = directives.updateDirective(req.params.id, req.body);
    res.json({ success: true, directive });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/directives", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const docs = directives.getDirectives(pid);
    res.json({ directives: docs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/directives/:id/text", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const docs = directives.getDirectives(pid);
    const doc = docs.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const text = directives.generateDirectiveText(doc);
    res.setHeader("Content-Type", "text/plain");
    res.send(text);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Second Opinion Coordination ─────────────────────────
const secondOpinion = require("./tools/second-opinion");
app.post("/api/second-opinion/request", (req, res) => {
  try {
    const request = secondOpinion.createRequest(req.body);
    addNotification("appointment", "Second Opinion Request", "Started for " + (req.body.condition || "condition"), req.body.patientId || getCurrentPatientId(), null);
    res.json({ success: true, request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/second-opinion", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const requests = secondOpinion.getRequests(pid);
    res.json({ requests });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/second-opinion/:id", (req, res) => {
  try {
    const request = secondOpinion.updateRequest(req.params.id, req.body);
    res.json({ success: true, request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/second-opinion/:id/doc", (req, res) => {
  try {
    const request = secondOpinion.updateDocumentStatus(req.params.id, req.body.docName, req.body.gathered);
    res.json({ success: true, request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/second-opinion/:id/step", (req, res) => {
  try {
    const request = secondOpinion.updateStepStatus(req.params.id, req.body.step, req.body.status);
    res.json({ success: true, request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Insurance Claims ────────────────────────────────────
const insuranceClaims = require("./tools/insurance-claims");
app.post("/api/claims/create", (req, res) => {
  try {
    const claim = insuranceClaims.createClaim(req.body);
    res.json({ success: true, claim });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/claims", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const claims = insuranceClaims.getClaims(pid, req.query.status);
    const summary = insuranceClaims.getClaimsSummary(pid);
    res.json({ claims, summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/claims/:id/status", (req, res) => {
  try {
    const claim = insuranceClaims.updateClaimStatus(req.params.id, req.body.status, req.body.details);
    res.json({ success: true, claim });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/claims/:id/appeal", (req, res) => {
  try {
    const claim = insuranceClaims.createAppeal(req.params.id, req.body.reason, req.body.docs);
    const patient = getAllPatients().find(p => p.id === (req.body.patientId || getCurrentPatientId()));
    const letter = insuranceClaims.generateAppealLetter(claim, patient);
    res.json({ success: true, claim, appealLetter: letter });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/claims/summary", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const summary = insuranceClaims.getClaimsSummary(pid);
    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EHR Integration ─────────────────────────────────────
const ehrIntegration = require("./tools/ehr-integration");
app.get("/api/ehr/status", (_req, res) => {
  try {
    const status = ehrIntegration.getConnectionStatus();
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/ehr/supported", (_req, res) => {
  try {
    const ehrs = ehrIntegration.getSupportedEHRs();
    res.json({ ehrs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/ehr/connect", (req, res) => {
  try {
    const { ehrType, clientId, redirectUri } = req.body;
    const result = ehrIntegration.initiateConnection(ehrType, clientId, redirectUri);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// ─── Priority Network ───────────────────────────────────
const priorityNetwork = require("./tools/priority-network");

// Provider registration & management
app.post("/api/network/register-provider", (req, res) => {
  try {
    const session = req.userSession;
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    const provider = priorityNetwork.registerProvider({ userId: session.userId, ...req.body });
    res.json({ success: true, provider });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/network/provider", (req, res) => {
  try {
    const session = req.userSession;
    const provider = priorityNetwork.getProviderByUserId(session?.userId);
    res.json({ provider });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/network/provider/:id", (req, res) => {
  try {
    const provider = priorityNetwork.updateProvider(req.params.id, req.body);
    res.json({ success: true, provider });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/network/search-providers", (req, res) => {
  try {
    const providers = priorityNetwork.searchProviders({
      specialty: req.query.specialty,
      insurance: req.query.insurance,
      type: req.query.type,
      verified: req.query.verified === "true"
    });
    res.json({ providers, count: providers.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/network/verify-provider/:id", (req, res) => {
  try {
    const provider = priorityNetwork.verifyProvider(req.params.id);
    res.json({ success: true, provider });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Patient-Provider connections
app.post("/api/network/connect", (req, res) => {
  try {
    const session = req.userSession;
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    const { patientId, providerId } = req.body;
    const result = priorityNetwork.connectPatientToProvider(
      patientId || getCurrentPatientId(), session.userId, providerId
    );
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/network/my-providers", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const connections = priorityNetwork.getPatientConnections(pid);
    res.json({ connections });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/network/my-patients", (req, res) => {
  try {
    const session = req.userSession;
    const provider = priorityNetwork.getProviderByUserId(session?.userId);
    if (!provider) return res.json({ connections: [] });
    const connections = priorityNetwork.getProviderConnections(provider.id);
    res.json({ connections });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/network/disconnect/:connectionId", (req, res) => {
  try {
    const result = priorityNetwork.disconnectPatientFromProvider(req.params.connectionId);
    res.json({ success: true, connection: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Priority Queue
app.post("/api/network/request", (req, res) => {
  try {
    const session = req.userSession;
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    const request = priorityNetwork.submitPriorityRequest({
      patientUserId: session.userId,
      ...req.body,
      patientId: req.body.patientId || getCurrentPatientId()
    });
    const statusMsg = request.networkConnected
      ? "Priority request submitted — estimated response: " + request.estimatedResponse
      : "Request submitted — estimated response: " + request.estimatedResponse + ". Connect with this provider for priority access.";
    res.json({ success: true, request, message: statusMsg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/network/patient-queue", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const queue = priorityNetwork.getPatientQueue(pid);
    res.json({ queue });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/network/provider-queue", (req, res) => {
  try {
    const session = req.userSession;
    const provider = priorityNetwork.getProviderByUserId(session?.userId);
    if (!provider) return res.json({ queue: [] });
    const queue = priorityNetwork.getProviderQueue(provider.id);
    res.json({ queue });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/network/respond/:requestId", (req, res) => {
  try {
    const result = priorityNetwork.respondToRequest(req.params.requestId, req.body.response, req.body.status);
    res.json({ success: true, request: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Provider Dashboard
app.get("/api/network/dashboard", (req, res) => {
  try {
    const session = req.userSession;
    const provider = priorityNetwork.getProviderByUserId(session?.userId);
    if (!provider) return res.json({ error: "Not a registered provider" });
    const dashboard = priorityNetwork.getProviderDashboard(provider.id);
    res.json(dashboard);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Network Analytics
app.get("/api/network/stats", (_req, res) => {
  try {
    const stats = priorityNetwork.getNetworkStats();
    res.json(stats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// --- Patient Packet and QR Code ---
const patientPacket = require("./tools/patient-packet");
app.get("/api/packet/generate", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const packet = patientPacket.generatePatientPacket(patient);
    res.json(packet);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/packet/text", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const packet = patientPacket.generatePatientPacket(patient);
    const text = patientPacket.formatPacketAsText(packet);
    res.setHeader("Content-Type", "text/plain");
    res.send(text);
  } catch (e) { res.status(500).send("Error: " + e.message); }
});
app.get("/api/packet/html", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const packet = patientPacket.generatePatientPacket(patient);
    const html = patientPacket.formatPacketAsHTML(packet);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (e) { res.status(500).send("Error: " + e.message); }
});
app.post("/api/packet/share", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "http://localhost:" + (process.env.PORT || 3000);
    const packet = patientPacket.generatePatientPacket(patient);
    const result = patientPacket.createShareLink(pid, packet, req.body.expiresHours || 24);
    const shareUrl = baseUrl + "/shared/" + result.token;
    res.json({ success: true, shareUrl, expiresIn: (req.body.expiresHours || 24) + " hours" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/packet/qr", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "http://localhost:" + (process.env.PORT || 3000);
    const qr = patientPacket.generateQRData(patient, baseUrl);
    res.json(qr);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/shared/:token", (req, res) => {
  try {
    const html = patientPacket.getSharedPacket(req.params.token);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (e) { res.status(404).send("Link expired or invalid. Request a new one from Health Agent."); }
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
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
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
const APP_URL = process.env.APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "http://localhost:" + PORT;
console.log("APP_URL:", APP_URL);
// Auto-seed admin account if no users exist
async function seedAdminAccount() {
  try {
    const usersFile = path.join(__dirname, "data", "users.json");
    let users = [];
    try { users = JSON.parse(fs.readFileSync(usersFile, "utf8")); } catch(e) {}
    if (users.length > 0) return;
    const admin = await auth.registerUser({
      email: "jf1986@me.com",
      password: "Health2251",
      name: "J Fields",
      role: "caregiver"
    });
    console.log("Admin account created:", admin.email);
    const patientsFile = path.join(__dirname, "data", "patients.json");
    try {
      const pData = JSON.parse(fs.readFileSync(patientsFile, "utf8"));
      const pts = pData.patients || pData;
      (Array.isArray(pts) ? pts : []).forEach(p => { if (!p.ownerId) p.ownerId = admin.id; });
      fs.writeFileSync(patientsFile, JSON.stringify(pData, null, 2));
    } catch(e) {}
  } catch(e) { console.log("Seed error:", e.message); }
}
seedAdminAccount();

app.listen(PORT, () => {
  console.log(`\n🏥 Health Agent running on http://localhost:${PORT}`);
  console.log(`📅 Google Calendar: ${googleTokens ? '✅ Connected' : '⚠️  Not connected — visit /auth/google'}`);
  console.log(`🔔 Notifications: ${NOTIFICATIONS_FILE}`);
  console.log(`💬 Chat history: ${CHAT_HISTORY_FILE}\n`);
});
// === Lead Pipeline & Verification Routes ===


