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

// ─── Adaptive Intelligence Systems ──────────────────────
const adaptiveAgent = require("./tools/adaptive-agent");
const playbooks = require("./tools/emergency-playbooks");
const legalSafety = require("./tools/legal-safety");
const emergencyCascade = require("./tools/emergency-cascade");
const knowledgeUpdater = require("./tools/knowledge-updater");
const { buildSystemPrompt } = require("./tools/system-prompt");
const { cleanupAIResponse, extractActions, buildChatResponse } = require("./tools/chat-response");
const { PHIScrubber } = require("./tools/phi-scrubber");

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

function getAllPatientsUnfiltered() { return getAllPatientsRaw(); }
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
// System prompt moved to tools/system-prompt.js
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
    const filtered = userId ? allRaw.filter(p => !p.ownerId || p.ownerId === userId) : allRaw;
    const patients = (filtered && filtered.length > 0) ? filtered : allRaw;
    res.json({ patients });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/patients/current', (req, res) => {
  try {
    const userId = req.userSession?.userId || null;
    const allRaw = typeof getAllPatientsUnfiltered === 'function' ? getAllPatientsUnfiltered() : getAllPatients();
    const filtered = userId ? allRaw.filter(p => !p.ownerId || p.ownerId === userId) : allRaw;
    const patients = (filtered && filtered.length > 0) ? filtered : allRaw;
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
  // Track interaction for adaptive learning
  try { if(req.userSession?.userId) adaptiveAgent.trackInteraction(req.userSession.userId, currentPatientId, 'chat', message?.substring(0,50)); } catch(e){}
  const patients = getAllPatients();
  const patient = patients.find((p) => p.id === currentPatientId) || patients[0] || {};
  conversationHistory.push({ role: 'user', content: message });
  // HIPAA PHI audit log
  try { hipaaCompliance.logPhiAccess(req.userSession?.userId||'unknown', currentPatientId, 'chat', 'conversation', 'success', req.ip||'unknown'); } catch(e){}
  try {
    // ── PHI De-identification: scrub before sending to Claude ──
    const scrubber = new PHIScrubber();
    const scrubbedSystem = scrubber.scrubSystemPrompt(buildSystemPrompt(patient), patient);
    const scrubbedMessages = conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.role === 'user' ? scrubber.scrub(msg.content, patient).scrubbed : msg.content
    }));
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: scrubbedSystem,
      messages: scrubbedMessages
    });
    // Re-identify: restore original values in Claude's response
    const rawReply = response.content?.[0]?.text || 'No response returned.';
    const reply = scrubber.restore(rawReply);
  // Auto FDA drug lookup when medications mentioned
  const drugMentioned = message?.match(/(?:about|taking|dose of|what is|check)\s+([A-Z][a-z]+(?:in|ol|ide|ate|one|ine)?)/)?.[1];
  if(drugMentioned && reply.length < 2000) {
    try {
      const fdaData = await medCodes.lookupDrug(drugMentioned);
      if(fdaData?.blackBoxWarning) {
        console.log('[FDA] Black box warning found for', drugMentioned);
      }
    } catch(e) {}
  }
    // Emergency detection
  if(legalSafety.checkEmergency(message)) {
    return res.json(buildChatResponse(legalSafety.buildEmergencyResponse(message)));
  }
  conversationHistory.push({ role: 'assistant', content: reply });
  // Audit and add disclaimer if needed
  const audit = legalSafety.auditHealthAdvice(reply);
  const finalReply = audit.needsDisclaimer ? legalSafety.addDisclaimer(reply, true) : reply;
    // ── Extract all actions from AI reply ──
    const actions = extractActions(reply);
    // Process email draft
    if (actions.emailDraft) {
      pendingEmailDraft = actions.emailDraft;
      emailTools.saveDraft(pendingEmailDraft.to, pendingEmailDraft.subject, pendingEmailDraft.body);
    }
    // Process call request
    if (actions.callRequest) {
      pendingCallRequest = actions.callRequest;
      if (pendingCallRequest.phone) {
        pendingCallRequest.phone = normalizeUSPhone(pendingCallRequest.phone);
      }
      return res.json(buildChatResponse(finalReply, {
        callRequest: pendingCallRequest,
        hasPendingEmail: !!pendingEmailDraft,
        hasPendingCall: true,
      }));
    }
    // Emergency playbook auto-detection
    const pbMatch = playbooks.detectPlaybook(message);
    if (pbMatch && !lower.includes('second opinion')) {
      return res.json(buildChatResponse(finalReply, {
        emergencyPlaybook: pbMatch,
        hasPendingEmail: !!pendingEmailDraft,
        hasPendingCall: !!pendingCallRequest,
      }));
    }
    // Second opinion auto-detection
    const soKeywords = ['second opinion','2nd opinion','another doctor','different specialist','get another opinion'];
    if (soKeywords.some(k => lower.includes(k))) {
      try {
        const soConnector = require('./tools/second-opinion-connector');
        const conditionHint = lower.includes('eye')||lower.includes('dry')?'dry eye':lower.includes('spine')||lower.includes('back')?'spine':lower.includes('thyroid')?'thyroid':'general';
        const soPrograms = soConnector.matchPrograms({ specialty: conditionHint, insurance: patient.insurance?.primary || '', condition: conditionHint });
        if (soPrograms.length) {
          return res.json(buildChatResponse(finalReply, {
            secondOpinionPrograms: soPrograms.slice(0, 4),
            hasPendingEmail: !!pendingEmailDraft,
            hasPendingCall: !!pendingCallRequest,
          }));
        }
      } catch(e) { console.log('SO connector error:', e.message); }
    }
    // Provider search links
    let providerLinks = null;
    if (actions.providerSearch) {
      try {
        const { buildProviderSearchURL } = require("./tools/insurance");
        providerLinks = buildProviderSearchURL(actions.providerSearch.insurance, actions.providerSearch.specialty, actions.providerSearch.location);
      } catch(e) {}
    }
    // Medication refill notification
    if (reply.toLowerCase().includes('refill') || reply.toLowerCase().includes('prescription')) {
      addNotification('medication', 'Medication Refill Reminder', `Chat mention: ${String(message).substring(0, 80)}`, currentPatientId, null);
    }
    res.json(buildChatResponse(finalReply, {
      calendarEvent: actions.calendarEvent || null,
      hasPendingEmail: !!pendingEmailDraft,
      hasPendingCall: !!pendingCallRequest,
      providerLinks,
    }));
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
              'ELITE DOCUMENT EXTRACTION — HEALTH AGENT VISION SYSTEM\n\n' +
'STEP 1 — COUNT: Before doing anything, count every distinct document, card, or piece of paper visible in this image. Look for: different card sizes, different backgrounds, different logos, different text blocks. A Medicare card + Aetna card = 2 documents. Front + back of same card = 2 documents. Write your count at the start of your analysis.\n\n' +
'STEP 2 — EXTRACT ALL: If you see 2+ documents, you MUST extract ALL of them. Missing any document is a critical failure. Use the documents array format.\n\n' +
'STEP 3 — PRECISION: Read every character with surgical precision. Member IDs, group numbers, RX BIN, PCN, phone numbers — these must be exact. If a character is unclear, mark it [unclear] not skip it.\n\n' +
'DOCUMENT TYPES AND REQUIRED FIELDS:\n' +
'INSURANCE CARD: insurance_company, plan_name, plan_type (HMO/PPO/Medicare/Medicaid/Supplement), member_name, member_id, group_number, rx_bin, rx_pcn, rx_group, rx_id, copay_info (office/specialist/ER/urgent care amounts), effective_date, phone_numbers (member_services, provider, pharmacy, mental_health, claims), website, back_of_card_info\n' +
'PRESCRIPTION BOTTLE: medication_name, ndc_number, dosage, strength, quantity, days_supply, refills_remaining, refill_by_date, expiration_date, fill_date, rx_number, prescriber_name, prescriber_dea, prescriber_npi, pharmacy_name, pharmacy_phone, pharmacy_address, patient_name, directions, warnings, generic_available\n' +
'LAB RESULT: lab_name, lab_address, ordering_physician, npi, patient_name, patient_dob, collection_date, report_date, accession_number, test_name (each test separately), result_value, units, reference_range_low, reference_range_high, abnormal_flag (H/L/HH/LL/A), result_status, performing_lab\n' +
'MEDICAL BILL/EOB: provider_name, provider_npi, provider_address, claim_number, date_of_service, billed_amount, allowed_amount, insurance_paid, adjustment, patient_responsibility, deductible_applied, copay, coinsurance, procedure_codes (CPT), diagnosis_codes (ICD-10), denial_reason_code, appeal_deadline\n' +
'CT/MRI ORDER: ordering_physician, patient_name, dob, study_type, body_part, clinical_indication, contrast, priority, scheduling_instructions, diagnosis_codes, insurance_auth_number\n\n' +
'MULTI-CARD PROTOCOL — THIS IS CRITICAL:\n' +
'If you see Medicare card + Aetna supplement = TWO cards, extract BOTH completely\n' +
'Medicare card fields: Name, Medicare Number (format: XXX-XX-XXXX-XX), Is entitled to: Hospital (Part A), Medical (Part B), Effective dates\n' +
'Supplement card fields: Company, Plan letter (A/B/C/D/G/K/L/M/N), Member ID, Group, All phone numbers\n' +
'NEVER combine two cards into one. NEVER skip the second card.\n\n' +
'RETURN FORMAT:\n' +
'Single document: EXTRACTED_DATA:{...all fields...}\n' +
'Multiple documents: EXTRACTED_DATA:{"documents":[{document 1 complete},{document 2 complete},{document 3 if exists}]}\n' +
'Each document MUST have: document_type, summary, confidence (high/medium/low based on image clarity), all extracted fields\n\n' +
'CONFIDENCE RULES: high = all text clearly readable. medium = some blur but key fields readable. low = significant blur but attempted extraction.\n\n' +
'For patient: ' + (patient?.name || 'Unknown') + '\n\n' +
'IMAGE ANALYSIS: Look at every corner of the image. Cards are often placed at angles or overlapping. Read ALL visible text including fine print, back-of-card info, and any handwritten notes.'
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
      try { enterprise.recordOutcome('health-agent-consumer', currentPatientId, 'document_scanned', { type: extracted?.document_type||'unknown' }); } catch(e){}
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
    // Notify admin of new registration
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.FROM_EMAIL || "Health Agent <onboarding@resend.dev>",
          to: "fields@dealmatcherapp.com",
          subject: "New User Registration — Health Agent",
          html: "<h2>New User Registered</h2>" +
            "<p><strong>Name:</strong> " + (name || "N/A") + "</p>" +
            "<p><strong>Email:</strong> " + email + "</p>" +
            "<p><strong>Date:</strong> " + new Date().toLocaleString() + "</p>"
        });
      } catch (emailErr) {
        console.error("Admin notification email failed:", emailErr.message);
      }
    }
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




// Check-in monitoring — every 15 minutes
// If patient misses a check-in, fire cascade alert
cron.schedule("*/15 * * * *", async () => {
  try {
    const missed = emergencyCascade.getMissedCheckins();
    for(const checkin of missed) {
      const patient = getAllPatientsRaw().find(p => p.id === checkin.patientId) || {};
      const contacts = emergencyCascade.getContacts(checkin.patientId);
      if(!contacts.length) continue;
      console.log("[Emergency] Missed check-in for", patient.name||checkin.patientId, "- overdue by", checkin.overdueMinutes, "minutes");
      // Fire cascade after 30 minutes overdue
      if(checkin.overdueMinutes >= 30 && !checkin.alertFired) {
        const detail = patient.name+" has not checked in. Last check-in was "+checkin.overdueMinutes+" minutes ago.";
        await emergencyCascade.dispatchCascade(patient, contacts, "Missed Check-In Alert", detail, "US", emailTools, voice);
        // Mark as fired to prevent repeat
        const checkins = JSON.parse(require("fs").readFileSync(require("path").join(__dirname,"data/checkins.json"),"utf8"));
        const pc = checkins[checkin.patientId]||[];
        const idx = pc.findIndex(c=>c.id===checkin.id);
        if(idx!==-1){pc[idx].alertFired=true;checkins[checkin.patientId]=pc;require("fs").writeFileSync(require("path").join(__dirname,"data/checkins.json"),JSON.stringify(checkins,null,2));}
        addNotification("general","Check-In Alert Fired",detail,checkin.patientId,null);
      }
    }
  } catch(e) { console.log("[Emergency] Check-in cron error:", e.message); }
});

// Nightly knowledge upgrade at 11pm
cron.schedule("0 23 * * *", async () => {
  try {
    console.log("[Cron] Starting nightly knowledge upgrade...");
    await knowledgeUpdater.runNightlyUpgrade(anthropic);
    // Generate proactive insights for all patients
    const pats = getAllPatientsRaw();
    pats.forEach(patient => {
      if(!patient.id) return;
      const insights = adaptiveAgent.generateProactiveInsights(patient.id, patient, []);
      adaptiveAgent.saveInsights(patient.id, insights);
    });
    console.log("[Cron] Nightly upgrade complete");
  } catch(e) { console.log("[Cron] Upgrade error:", e.message); }
});

// Daily briefing at 8am
cron.schedule("0 8 * * *", () => {
  try {
    const pats = getAllPatientsRaw();
    pats.forEach(patient => {
      if(!patient.id) return;
      const tasks = [];
      const appointments = [];
      const notifs = (loadNotifications().notifications || []);
      try { const t = require("./tools/tasks"); tasks.push(...(t.listTasks(patient.id)||[])); } catch(e){}
      try { const a = require("./tools/appointments-booking"); appointments.push(...(a.getUpcoming(patient.id,7)||[])); } catch(e){}
      const briefing = require("./tools/daily-briefing").generateBriefing(patient, tasks, appointments, notifs);
      addNotification("general", "Morning Briefing", briefing.text.substring(0,120)+"...", patient.id, null);
    });
    console.log("Daily briefings generated at 8am");
  } catch(e) { console.log("Briefing cron error:", e.message); }
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
    try { enterprise.recordOutcome('health-agent-consumer', req.body.patientId||getCurrentPatientId(), 'appeal_filed', { claimId: req.params.id }); } catch(e){}
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


// --- Form Fill Assistant ---
var formFiller = require("./tools/form-filler");
app.get("/api/checkin/sheet", function(req, res) {
  try {
    var pid = req.query.patientId || getCurrentPatientId();
    var allPats = typeof getAllPatientsUnfiltered === "function" ? getAllPatientsUnfiltered() : getAllPatients(); var patient = allPats.find(function(p) { return p.id === pid; });
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    var sheet = formFiller.generateCheckInSheet(patient);
    res.json(sheet);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/checkin/text", function(req, res) {
  try {
    var pid = req.query.patientId || getCurrentPatientId();
    var allPats = typeof getAllPatientsUnfiltered === "function" ? getAllPatientsUnfiltered() : getAllPatients(); var patient = allPats.find(function(p) { return p.id === pid; });
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    var sheet = formFiller.generateCheckInSheet(patient);
    res.setHeader("Content-Type", "text/plain");
    res.send(formFiller.formatCheckInAsText(sheet));
  } catch (e) { res.status(500).send("Error: " + e.message); }
});
app.get("/api/checkin/html", function(req, res) {
  try {
    var pid = req.query.patientId || getCurrentPatientId();
    var allPats = typeof getAllPatientsUnfiltered === "function" ? getAllPatientsUnfiltered() : getAllPatients(); var patient = allPats.find(function(p) { return p.id === pid; });
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    var sheet = formFiller.generateCheckInSheet(patient);
    res.setHeader("Content-Type", "text/html");
    res.send(formFiller.formatCheckInAsHTML(sheet));
  } catch (e) { res.status(500).send("Error: " + e.message); }
});


// --- Treatment Tracker ---
var treatmentTracker = require("./tools/treatment-tracker");
app.post("/api/treatments/add", function(req, res) { try { var t = treatmentTracker.addTreatment(req.body); res.json({ success: true, treatment: t }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get("/api/treatments", function(req, res) { try { var pid = req.query.patientId || getCurrentPatientId(); var t = treatmentTracker.getTreatments(pid, req.query.status); res.json({ treatments: t }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put("/api/treatments/:id", function(req, res) { try { var t = treatmentTracker.updateTreatment(req.params.id, req.body); res.json({ success: true, treatment: t }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post("/api/treatments/:id/stop", function(req, res) { try { var t = treatmentTracker.stopTreatment(req.params.id, req.body.reason, req.body.effectiveness, req.body.endDate); res.json({ success: true, treatment: t }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post("/api/treatments/:id/side-effect", function(req, res) { try { var t = treatmentTracker.addSideEffect(req.params.id, req.body.effect, req.body.severity, req.body.date); res.json({ success: true, treatment: t }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get("/api/treatments/report", function(req, res) { try { var pid = req.query.patientId || getCurrentPatientId(); var r = treatmentTracker.generateTreatmentReport(pid); res.json(r); } catch(e) { res.status(500).json({ error: e.message }); } });

// --- Photo Condition Tracker ---
var photoTracker = require("./tools/photo-tracker");
app.post("/api/photos/log", function(req, res) { try { var p = photoTracker.logPhoto(req.body); res.json({ success: true, photo: p }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get("/api/photos/history", function(req, res) { try { var pid = req.query.patientId || getCurrentPatientId(); var photos = photoTracker.getPhotoHistory(pid, req.query.bodyArea, parseInt(req.query.days) || null); res.json({ photos }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get("/api/photos/progress", function(req, res) { try { var pid = req.query.patientId || getCurrentPatientId(); var report = photoTracker.getProgressReport(pid, req.query.bodyArea); res.json(report); } catch(e) { res.status(500).json({ error: e.message }); } });

// --- Provider Coordinator ---
var providerCoord = require("./tools/provider-coordinator");
app.post("/api/coordination/check", function(req, res) { try { var alerts = providerCoord.checkMedChangeAlerts(req.body.medication, req.body.changeType, req.body.doctors); res.json({ alerts }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get("/api/coordination/alerts", function(req, res) { try { var pid = req.query.patientId || getCurrentPatientId(); var alerts = providerCoord.getActiveAlerts(pid); res.json({ alerts }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get("/api/coordination/report", function(req, res) { try { var pid = req.query.patientId || getCurrentPatientId(); var patient = getAllPatients().find(function(p){return p.id===pid}); var report = providerCoord.generateCoordinationReport(pid, patient ? patient.medications : [], patient ? patient.specialists : []); res.json(report); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post("/api/coordination/resolve/:id", function(req, res) { try { var a = providerCoord.resolveAlert(req.params.id); res.json({ success: true, alert: a }); } catch(e) { res.status(500).json({ error: e.message }); } });

// --- Smart Appointment Prep ---
var smartPrep = require("./tools/smart-prep");
app.get("/api/prep/:appointmentId", function(req, res) {
  try {
    var pid = req.query.patientId || getCurrentPatientId();
    var patient = getAllPatients().find(function(p){return p.id===pid});
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    var apptBooking = require("./tools/appointments-booking");
    var upcoming = apptBooking.getUpcoming(pid, 365);
    var appt = upcoming.find(function(a){return a.id===req.params.appointmentId});
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    var symptoms = []; var medChanges = []; var labFlags = [];
    try { symptoms = JSON.parse(fs.readFileSync(path.join(__dirname,"data","symptom_log.json"),"utf8")).filter(function(s){return s.patientId===pid}).slice(-10); } catch(e){}
    try { medChanges = JSON.parse(fs.readFileSync(path.join(__dirname,"data","med_changes.json"),"utf8")).filter(function(m){return m.patientId===pid}).slice(-5); } catch(e){}
    try { var labHist = JSON.parse(fs.readFileSync(path.join(__dirname,"data","lab_history.json"),"utf8")).filter(function(l){return l.patientId===pid}); if(labHist.length>0) labFlags = (labHist[labHist.length-1].analysis||{}).urgentFlags||[]; } catch(e){}
    var recentData = { symptoms: symptoms, medChanges: medChanges, labFlags: labFlags, recentLabs: [], recentImaging: [], concerns: [] };
    var prep = smartPrep.generateSmartPrep(patient, appt, recentData);
    res.json(prep);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/prep/:appointmentId/text", function(req, res) {
  try {
    var pid = req.query.patientId || getCurrentPatientId();
    var patient = getAllPatients().find(function(p){return p.id===pid});
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    var apptBooking = require("./tools/appointments-booking");
    var upcoming = apptBooking.getUpcoming(pid, 365);
    var appt = upcoming.find(function(a){return a.id===req.params.appointmentId});
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    var prep = smartPrep.generateSmartPrep(patient, appt, { symptoms:[], medChanges:[], labFlags:[] });
    res.setHeader("Content-Type", "text/plain");
    res.send(smartPrep.formatPrepAsText(prep));
  } catch(e) { res.status(500).send("Error: "+e.message); }
});


// ─── Second Opinion Connector ────────────────────────────
app.get("/api/second-opinion/match", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid) || getAllPatientsRaw()[0] || {};
    const programs = soConnector.matchPrograms({
      specialty: req.query.specialty || "",
      insurance: patient.insurance?.primary || "",
      condition: req.query.condition || ""
    });
    res.json({ programs, count: programs.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/second-opinion/summary", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === pid) || getAllPatientsRaw()[0] || {};
    const summary = soConnector.buildCaseSummary(patient, req.query.condition || "");
    res.setHeader("Content-Type", "text/plain");
    res.send(summary);
  } catch(e) { res.status(500).send("Error: " + e.message); }
});


// ─── Daily Briefing ──────────────────────────────────────
const dailyBriefing = require("./tools/daily-briefing");
app.get("/api/briefing/today", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || getAllPatientsRaw()[0] || {};
    const tasks = [];
    const appointments = [];
    const notifs = (loadNotifications().notifications || []);
    try { const t = require("./tools/tasks"); tasks.push(...(t.listTasks(pid)||[])); } catch(e){}
    try { const a = require("./tools/appointments-booking"); appointments.push(...(a.getUpcoming(pid,7)||[])); } catch(e){}
    const briefing = dailyBriefing.generateBriefing(patient, tasks, appointments, notifs);
    res.json(briefing);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/briefing/html", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || getAllPatientsRaw()[0] || {};
    const tasks = [];
    const appointments = [];
    const notifs = (loadNotifications().notifications || []);
    try { const t = require("./tools/tasks"); tasks.push(...(t.listTasks(pid)||[])); } catch(e){}
    try { const a = require("./tools/appointments-booking"); appointments.push(...(a.getUpcoming(pid,7)||[])); } catch(e){}
    const briefing = dailyBriefing.generateBriefing(patient, tasks, appointments, notifs);
    const html = dailyBriefing.generateHTML(briefing);
    res.setHeader("Content-Type","text/html");
    res.send(html);
  } catch(e) { res.status(500).send("Error: " + e.message); }
});

// ─── Lab Dashboard ───────────────────────────────────────
const labDashboard = require("./tools/lab-dashboard");
app.get("/api/labs/dashboard", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || getAllPatientsRaw()[0] || {};
    const dashboard = labDashboard.buildDashboard(pid);
    const insights = labDashboard.generateInsights(dashboard, patient);
    res.json({ ...dashboard, insights });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Med Impact Tracker ──────────────────────────────────
const medImpact = require("./tools/med-impact-tracker");
app.post("/api/med-changes/log", (req, res) => {
  try {
    const { patientId, medication, changeType, oldDose, newDose, reason, prescriber } = req.body;
    const entry = medImpact.logChange(patientId||getCurrentPatientId(), medication, changeType, oldDose, newDose, reason, prescriber);
    res.json({ success: true, entry });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/med-changes/:id/impact", (req, res) => {
  try {
    const entry = medImpact.addImpact(req.params.id, req.body.impact, req.body.severity, req.body.date);
    res.json({ success: true, entry });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/med-changes", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const changes = medImpact.getChanges(pid, req.query.medication);
    res.json({ changes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/med-changes/report", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const report = medImpact.generateImpactReport(pid);
    res.json(report);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ─── Insurance Card Wallet ───────────────────────────────
const insWallet = require("./tools/insurance-wallet");
app.get("/api/insurance-wallet", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const cards = insWallet.getCards(pid);
    res.json({ cards });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/insurance-wallet/add", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const card = insWallet.addCard(pid, req.body);
    res.json({ success: true, card });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/insurance-wallet/:id", (req, res) => {
  try { insWallet.deleteCard(req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/insurance-wallet/share", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || {};
    const text = insWallet.buildQuickShareText(pid, patient);
    res.setHeader("Content-Type","text/plain");
    res.send(text);
  } catch(e) { res.status(500).send("Error: " + e.message); }
});


// ─── Doctor Visit Recorder ───────────────────────────────
const visitRecorder = require("./tools/visit-recorder");
app.post("/api/visits/create", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const visit = visitRecorder.createVisit(pid, req.body.doctorName, req.body.visitType, req.body.date);
    res.json({ success: true, visit });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/visits", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const visits = visitRecorder.getVisits(pid);
    res.json({ visits });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/visits/:id/summarize", async (req, res) => {
  try {
    const { transcript } = req.body;
    if(!transcript) return res.status(400).json({ error: "Transcript required" });
    visitRecorder.saveTranscript(req.params.id, transcript);
    const prompt = visitRecorder.buildSummaryPrompt(transcript);
    const pid = getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || {};
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    });
    const text = response.content?.[0]?.text || "{}";
    let summary = {};
    try {
      const clean = text.replace(/```json|```/g,"").trim();
      summary = JSON.parse(clean);
    } catch(e) { summary = { summary: text }; }
    const visit = visitRecorder.saveSummary(req.params.id, summary);
    res.json({ success: true, visit, summary });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/visits/:id", (req, res) => {
  try {
    const visit = visitRecorder.getVisit(req.params.id);
    if(!visit) return res.status(404).json({ error: "Visit not found" });
    res.json(visit);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Adaptive Agent APIs ─────────────────────────────────
app.get("/api/agent/insights", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || {};
    const insights = adaptiveAgent.generateProactiveInsights(pid, patient, []);
    adaptiveAgent.saveInsights(pid, insights);
    res.json({ insights });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/agent/profile", (req, res) => {
  try {
    const session = req.userSession;
    if(!session) return res.status(401).json({ error: "Not authenticated" });
    const profile = adaptiveAgent.getProfile(session.userId);
    res.json({ profile });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/agent/knowledge", (req, res) => {
  try {
    const knowledge = adaptiveAgent.getKnowledge(req.query.topic || "");
    res.json({ knowledge });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/agent/upgrade", async (req, res) => {
  try {
    const result = await knowledgeUpdater.runNightlyUpgrade(anthropic);
    res.json({ success: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/agent/knowledge-status", (req, res) => {
  try {
    const kbPath = path.join(__dirname, "data", "health_knowledge.json");
    if(!fs.existsSync(kbPath)) return res.json({ hasKnowledge: false });
    const kb = JSON.parse(fs.readFileSync(kbPath,"utf8"));
    res.json({ hasKnowledge: true, topics: Object.keys(kb.topics||{}).length, lastUpdated: kb.lastUpdated, version: kb.version, pearls: (kb.clinicalPearls||[]).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Emergency Playbooks ─────────────────────────────────
app.get("/api/playbooks", (_req, res) => {
  try { res.json({ playbooks: playbooks.getAllPlaybooks() }); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/playbooks/:id", (req, res) => {
  try {
    const pb = playbooks.getPlaybook(req.params.id);
    if(!pb) return res.status(404).json({ error: "Playbook not found" });
    res.json(pb);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ─── PortalSync ───────────────────────────────────────────
const portalSync = require("./tools/portal-sync");
app.get("/api/portals", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const portals = portalSync.getPortals(pid);
    res.json({ portals });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/portals/find", (req, res) => {
  try {
    const results = portalSync.findPortalForQuery(req.query.q || "");
    res.json({ results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/portals/add", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const portal = portalSync.addCustomPortal(pid, req.body);
    res.json({ success: true, portal });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ─── Prior Authorization ──────────────────────────────────
const priorAuth = require("./tools/prior-auth");
app.post("/api/prior-auth/generate", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || {};
    const result = priorAuth.generatePARequest(patient, req.body.medication, req.body.diagnosis, req.body.clinicalJustification, req.body.prescriber);
    res.json({ success: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/prior-auth/history", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const history = priorAuth.getPAHistory(pid);
    res.json({ history });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Emergency Cascade System ────────────────────────────

app.get("/api/emergency/contacts/:patientId", (req, res) => {
  try {
    const contacts = emergencyCascade.getContacts(req.params.patientId);
    res.json({ contacts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/emergency/contacts/:patientId", (req, res) => {
  try {
    const contact = emergencyCascade.addContact(req.params.patientId, req.body);
    res.json({ success: true, contact });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/emergency/contacts/:patientId", (req, res) => {
  try {
    const contacts = emergencyCascade.saveContacts(req.params.patientId, req.body.contacts);
    res.json({ success: true, contacts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/emergency/checkin/:patientId", (req, res) => {
  try {
    emergencyCascade.recordCheckin(req.params.patientId);
    res.json({ success: true, checkedInAt: new Date().toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/emergency/setup-checkin", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const checkin = emergencyCascade.createCheckin(pid, req.body.intervalHours || 12, true);
    res.json({ success: true, checkin });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/emergency/numbers/:country", (req, res) => {
  try {
    const numbers = emergencyCascade.getEmergencyNumbers(req.params.country);
    res.json({ country: req.params.country, numbers });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/emergency/numbers", (_req, res) => {
  try {
    res.json({ numbers: emergencyCascade.getAllEmergencyNumbers() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/emergency/fire-cascade", async (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || {};
    const contacts = emergencyCascade.getContacts(pid);
    if(!contacts.length) return res.status(400).json({ error: "No emergency contacts set up. Add contacts first." });
    const result = await emergencyCascade.dispatchCascade(
      patient, contacts,
      req.body.triggerType || "Manual Emergency Alert",
      req.body.details || "",
      req.body.countryCode || "US",
      emailTools, voice
    );
    addNotification("general", "Emergency Alert Fired", result.contactsReached+" contacts notified via "+result.results.reduce((acc,r)=>acc+r.channels.length,0)+" channels", pid, null);
    res.json({ success: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/emergency/alerts/:patientId", (req, res) => {
  try {
    const alerts = emergencyCascade.getAlerts(req.params.patientId);
    res.json({ alerts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/emergency/alerts/:alertId/resolve", (req, res) => {
  try {
    emergencyCascade.resolveAlert(req.params.alertId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.post("/api/emergency/checkin-settings", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const { intervalHours, enabled } = req.body;
    const CHECKIN_FILE = require("path").join(__dirname,"data/checkins.json");
    let data = {};
    try { data = JSON.parse(fs.readFileSync(CHECKIN_FILE,"utf8")); } catch(e){}
    if(!data[pid]) data[pid] = [];
    if(!data[pid].length) {
      data[pid].push({ id: Date.now().toString(), patientId: pid, scheduleHours: intervalHours||12, active: enabled!==false, lastCheckin: new Date().toISOString(), nextDue: new Date(Date.now()+(intervalHours||12)*3600000).toISOString(), missedCount:0, alertFired:false });
    } else {
      data[pid].forEach(c => {
        if(intervalHours !== undefined) c.scheduleHours = Number(intervalHours);
        if(enabled !== undefined) c.active = !!enabled;
        if(enabled && intervalHours) c.nextDue = new Date(Date.now()+Number(intervalHours)*3600000).toISOString();
      });
    }
    fs.writeFileSync(CHECKIN_FILE, JSON.stringify(data,null,2));
    res.json({ success: true, settings: data[pid][0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/emergency/checkin-settings/:patientId", (req, res) => {
  try {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(CHECKIN_FILE,"utf8")); } catch(e){}
    const settings = (data[req.params.patientId]||[])[0] || { active: false, scheduleHours: 12 };
    res.json({ settings });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── FHIR Engine ─────────────────────────────────────────
const fhirEngine = require("./tools/fhir-engine");

app.get("/api/fhir/systems", (_req, res) => {
  try {
    const systems = fhirEngine.getAvailableSystems();
    res.json({ systems });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/fhir/connections", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const connections = fhirEngine.getConnections(pid);
    res.json({ connections });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/fhir/connect", (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const connection = fhirEngine.saveConnection(pid, {
      system: req.body.system,
      systemName: req.body.systemName,
      baseUrl: req.body.baseUrl,
      accessToken: req.body.accessToken,
      fhirPatientId: req.body.fhirPatientId,
      refreshToken: req.body.refreshToken || null
    });
    res.json({ success: true, connection });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/fhir/connections/:system", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    fhirEngine.removeConnection(pid, req.params.system);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/fhir/sync", async (req, res) => {
  try {
    const pid = req.body.patientId || getCurrentPatientId();
    const connections = fhirEngine.getConnections(pid);
    if(!connections.length) return res.status(400).json({ error: "No FHIR connections. Connect a health system first." });
    const allResults = [];
    for(const conn of connections) {
      if(!conn.accessToken || !conn.baseUrl) continue;
      try {
        const result = await fhirEngine.syncPatientData(pid, conn);
        allResults.push({ system: conn.system, ...result });
      } catch(e) { allResults.push({ system: conn.system, error: e.message }); }
    }
    res.json({ success: true, results: allResults });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/fhir/data/:resource", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const data = fhirEngine.getFhirData(pid, req.params.resource);
    res.json({ data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/fhir/data", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const data = fhirEngine.getFhirData(pid);
    res.json({ data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// SMART on FHIR OAuth callback
app.get("/fhir/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if(!code) return res.status(400).send("No authorization code received");
    const html = '<!DOCTYPE html><html><head><style>body{font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}.card{background:rgba(30,41,59,0.8);border:1px solid rgba(148,163,184,0.15);border-radius:20px;padding:32px;max-width:400px}h2{color:#2dd4bf;margin-bottom:12px}p{color:#94a3b8;font-size:14px;line-height:1.6}.code{background:rgba(20,184,166,0.1);border:1px solid rgba(20,184,166,0.3);border-radius:10px;padding:12px;font-family:monospace;font-size:13px;color:#2dd4bf;margin:16px 0;word-break:break-all}</style></head><body><div class="card"><h2>Authorization Received</h2><p>Copy this code and paste it into Health Agent to complete the connection.</p><div class="code">'+code+'</div><p style="font-size:12px;color:#64748b">This code expires in 10 minutes. Return to Health Agent now.</p></div><script>window.opener&&window.opener.postMessage({type:"fhir_auth",code:"'+code+'",state:"'+state+'"},"*");setTimeout(function(){window.close()},3000)<\/script></body></html>';
  res.send(html);
  } catch(e) { res.status(500).send("Error: " + e.message); }
});


// ─── Enterprise + HIPAA Compliance ──────────────────────
const enterprise = require("./tools/enterprise");
const medCodes = require("./tools/medical-codes");
const hipaaCompliance = require("./tools/hipaa-compliance");

// Tenant Management
app.get("/api/enterprise/tenants", (req, res) => {
  try {
    const session = req.userSession;
    if(!session) return res.status(401).json({ error: "Not authenticated" });
    const tenants = enterprise.getAllTenants();
    res.json({ tenants });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/enterprise/tenants", (req, res) => {
  try {
    const tenant = enterprise.createTenant(req.body);
    res.json({ success: true, tenant });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/enterprise/tenant/:tenantId", (req, res) => {
  try {
    const tenant = enterprise.getTenant(req.params.tenantId);
    res.json({ tenant });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Member Enrollment
app.post("/api/enterprise/enroll", (req, res) => {
  try {
    const { tenantId, ...memberData } = req.body;
    if(!tenantId) return res.status(400).json({ error: "tenantId required" });
    const enrollment = enterprise.enrollMember(tenantId, memberData);
    res.json({ success: true, enrollment });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/enterprise/enrollments/:tenantId", (req, res) => {
  try {
    const enrollments = enterprise.getEnrollments(req.params.tenantId);
    res.json({ enrollments, count: enrollments.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Outcomes Tracking
app.post("/api/enterprise/outcomes", (req, res) => {
  try {
    const { tenantId, patientId, outcomeType, data } = req.body;
    const outcome = enterprise.recordOutcome(tenantId||"health-agent-consumer", patientId||getCurrentPatientId(), outcomeType, data||{});
    res.json({ success: true, outcome });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/enterprise/outcomes/:tenantId", (req, res) => {
  try {
    const report = enterprise.generateOutcomesReport(req.params.tenantId);
    res.json(report);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/enterprise/star-measures", (_req, res) => {
  try { res.json({ measures: enterprise.getStarMeasures() }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// HIPAA Compliance
app.get("/api/compliance/status", (_req, res) => {
  try { res.json(hipaaCompliance.getComplianceStatus()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/compliance/audit", (req, res) => {
  try {
    const logs = hipaaCompliance.getAuditLog({
      patientId: req.query.patientId,
      userId: req.query.userId,
      since: req.query.since,
      limit: parseInt(req.query.limit)||100
    });
    res.json({ logs, count: logs.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/compliance/baa", (req, res) => {
  try {
    const { organizationName, contactEmail, signedBy } = req.body;
    const baa = hipaaCompliance.createBAA(organizationName, contactEmail, signedBy);
    res.json({ success: true, baa });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/compliance/baa/:org", (req, res) => {
  try {
    const baa = hipaaCompliance.getBAAStatus(req.params.org);
    res.json({ baa, active: !!baa });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CMS Patient Access API (FHIR R4 compliant endpoint)
app.get("/api/cms/patient-access", (req, res) => {
  try {
    const pid = req.query.patient || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || {};
    const fhirData = require("./tools/fhir-engine").getFhirData(pid);
    const bundle = enterprise.buildCMSPatientAccessResponse(patient, fhirData);
    res.setHeader("Content-Type","application/fhir+json");
    res.json(bundle);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Demo Mode ───────────────────────────────────────────
// Anyone can try without creating an account
app.get("/demo", (_req, res) => {
  res.sendFile(require("path").join(__dirname, "public", "app.html"));
});

app.get("/api/demo/patient", (_req, res) => {
  res.json({
    patients: [{
      id: "demo-patient",
      name: "Maria Johnson",
      relationship: "Mother",
      dob: "03/15/1950",
      age: 76,
      conditions: ["Type 2 Diabetes","Hypertension","Hypothyroidism","Dry Eye Disease"],
      medications: [
        { name:"Metformin", dose:"500mg", frequency:"twice daily" },
        { name:"Lisinopril", dose:"10mg", frequency:"daily" },
        { name:"Levothyroxine", dose:"75mcg", frequency:"daily" },
        { name:"Vitamin D3", dose:"2000IU", frequency:"daily" }
      ],
      allergies: ["Penicillin","Aspirin"],
      insurance: { primary:"Medicare", secondary:"AARP Supplement", memberId:"DEMO-12345" },
      primaryDoctor: "Dr. Rodriguez",
      clinic: "Family Medicine Associates",
      pharmacy: { name:"CVS Pharmacy", phone:"(210) 555-0100" },
      address: "San Antonio, TX 78258"
    }],
    isDemo: true
  });
});

app.post("/api/demo/chat", async (req, res) => {
  const { message } = req.body;
  const demoPatient = {
    name:"Maria Johnson", dob:"03/15/1950",
    conditions:["Type 2 Diabetes","Hypertension","Hypothyroidism","Dry Eye Disease"],
    medications:[{name:"Metformin",dose:"500mg"},{name:"Lisinopril",dose:"10mg"},{name:"Levothyroxine",dose:"75mcg"}],
    allergies:["Penicillin","Aspirin"],
    insurance:{primary:"Medicare",memberId:"DEMO-12345"}
  };
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: "You are Health Agent, an AI healthcare navigator. This is a DEMO session for a patient named Maria Johnson, age 76, with Type 2 Diabetes, Hypertension, Hypothyroidism, and Dry Eye Disease. She takes Metformin 500mg, Lisinopril 10mg, Levothyroxine 75mcg. Allergic to Penicillin. Medicare insurance. Be helpful, specific, and demonstrate the power of the app. Always add a brief disclaimer to verify with doctor. Keep responses concise and impressive for a demo.",
      messages: [{ role:"user", content: message||"Hello" }]
    });
    const reply = response.content?.[0]?.text || "Demo response";
    res.json({ reply, isDemo: true });
  } catch(e) {
    res.json({ reply: "This is Health Agent — your AI healthcare navigator. In a live account, I would help you scan documents, fight insurance denials, find doctors, check drug interactions, and navigate the entire healthcare system for Maria. Try the real app to see the full power.", isDemo: true });
  }
});


// ─── Symptom Triage ──────────────────────────────────────
const symptomTriage = require("./tools/symptom-triage");
app.get("/api/triage", (req, res) => {
  try {
    const pid = req.query.patientId || getCurrentPatientId();
    const patient = getAllPatientsRaw().find(p => p.id === pid) || {};
    const result = symptomTriage.triageSymptom(req.query.symptom || "", patient);
    // Record outcome
    try { enterprise.recordOutcome("health-agent-consumer", pid, "triage_performed", { level: result.triage?.level }); } catch(e){}
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── NPI Provider Registry ───────────────────────────────
const npiRegistry = require("./tools/npi-registry");
app.get("/api/providers/search", async (req, res) => {
  try {
    const result = await npiRegistry.searchProviders({
      firstName: req.query.firstName,
      lastName: req.query.lastName,
      specialty: req.query.specialty,
      city: req.query.city || "San Antonio",
      state: req.query.state || "TX",
      postalCode: req.query.zip,
      limit: parseInt(req.query.limit) || 10
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/providers/npi/:npi", async (req, res) => {
  try {
    const provider = await npiRegistry.lookupNPI(req.params.npi);
    if(!provider) return res.status(404).json({ error: "NPI not found" });
    res.json({ provider });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Medical Codes + FDA ─────────────────────────────────
app.get("/api/codes/icd10", async (req, res) => {
  try {
    const result = await medCodes.searchICD10(req.query.q || "");
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/codes/cpt/:code", (req, res) => {
  try {
    const explanation = medCodes.explainCPT(req.params.code);
    res.json({ code: req.params.code, explanation });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/drugs/lookup", async (req, res) => {
  try {
    const drug = await medCodes.lookupDrug(req.query.name || "");
    res.json({ drug });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/drugs/recalls", async (req, res) => {
  try {
    const result = await medCodes.checkDrugRecalls(req.query.name || "");
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Push Notifications ──────────────────────────────────
const pushNotifs = require("./tools/push-notifications");
app.post("/api/push/subscribe", (req, res) => {
  try {
    const session = req.userSession;
    if(!session) return res.status(401).json({ error: "Not authenticated" });
    const pid = req.body.patientId || getCurrentPatientId();
    pushNotifs.saveSubscription(session.userId, pid, req.body.subscription);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/push/status", (req, res) => {
  try {
    const session = req.userSession;
    if(!session) return res.json({ subscribed: false });
    const subs = pushNotifs.getSubscriptions(session.userId);
    res.json({ subscribed: subs.length > 0, count: subs.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

app.get('/emergency', (_req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'emergency.html'));
});

app.get('/landing', (_req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'landing.html'));
});
app.get('/terms', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
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
try { seedAdminAccount(); } catch(e) { console.error("seedAdminAccount failed:", e.message); }

try {
try {
app.listen(PORT, () => {
  console.log(`\n🏥 Health Agent running on http://localhost:${PORT}`);
  console.log(`📅 Google Calendar: ${googleTokens ? '✅ Connected' : '⚠️  Not connected — visit /auth/google'}`);
  console.log(`🔔 Notifications: ${NOTIFICATIONS_FILE}`);
  console.log(`💬 Chat history: ${CHAT_HISTORY_FILE}\n`);
});
} catch(startupErr) { console.log("Startup error:", startupErr.message); }
} catch(startupErr) { console.log("Startup error:", startupErr.message); }
// === Lead Pipeline & Verification Routes ===


