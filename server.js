
// ============================================================
// server.js — AI Health Agent (All Features — Corrected)
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

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use('/drafts', express.static('drafts'));
app.use('/calendar', express.static('calendar'));

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Data File Paths ───────────────────────────────────────
const CHAT_HISTORY_FILE = './data/chat_history.json';
const NOTIFICATIONS_FILE = './data/notifications.json';
const CURRENT_PATIENT_FILE = './data/current_patient.json';
const TOKEN_FILE = './data/google_tokens.json';
const TIMELINE_FILE = './data/timeline.json';

// ─── Ensure data directories exist ────────────────────────
['./data', './drafts', './calendar', './uploads'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Session State ─────────────────────────────────────────
let pendingUpdates = null;
let pendingEmailDraft = null;
let pendingCallRequest = null;
let conversationHistory = [];

// ─── Load chat history on startup ─────────────────────────
function loadChatHistory() {
  try {
    if (fs.existsSync(CHAT_HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
      return data.sessions || [];
    }
  } catch (e) {}
  return [];
}

function saveChatSession(patientId, messages) {
  try {
    let data = { sessions: [] };
    if (fs.existsSync(CHAT_HISTORY_FILE)) {
      data = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
    }
    const session = {
      id: Date.now().toString(),
      patientId,
      timestamp: new Date().toISOString(),
      preview: messages.find(m => m.role === 'user')?.content?.substring(0, 60) || 'Chat session',
      messages
    };
    data.sessions.unshift(session);
    data.sessions = data.sessions.slice(0, 50);
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(data, null, 2));
    return session.id;
  } catch (e) {
    console.error('Error saving chat history:', e);
  }
}

// ─── Notifications ─────────────────────────────────────────
function loadNotifications() {
  try {
    if (fs.existsSync(NOTIFICATIONS_FILE)) {
      return JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { notifications: [] };
}

function saveNotifications(data) {
  fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(data, null, 2));
}
function loadTimeline() {
  try {
    if (fs.existsSync(TIMELINE_FILE)) {
      return JSON.parse(fs.readFileSync(TIMELINE_FILE, 'utf8'));
    }
  } catch (e) {}
  return { events: [] };
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

// ─── Patient helpers ────────────────────────────────────────
function getCurrentPatientId() {
  try {
    if (fs.existsSync(CURRENT_PATIENT_FILE)) {
      return JSON.parse(fs.readFileSync(CURRENT_PATIENT_FILE, 'utf8')).patientId || 'maria-fields';
    }
  } catch (e) {}
  return 'maria-fields';
}

function setCurrentPatientId(id) {
  fs.writeFileSync(CURRENT_PATIENT_FILE, JSON.stringify({ patientId: id }));
}

function getAllPatients() {
  try {
    const data = JSON.parse(fs.readFileSync('./data/patients.json', 'utf8'));
    if (Array.isArray(data)) return data;
    if (data.patients) return data.patients;
    return [data];
  } catch (e) {
    return [];
  }
}

function saveAllPatients(patients) {
  try {
    const raw = fs.readFileSync('./data/patients.json', 'utf8');
    const existing = JSON.parse(raw);
    if (existing.patients) {
      fs.writeFileSync('./data/patients.json', JSON.stringify({ ...existing, patients }, null, 2));
    } else {
      fs.writeFileSync('./data/patients.json', JSON.stringify(patients, null, 2));
    }
  } catch (e) {
    fs.writeFileSync('./data/patients.json', JSON.stringify({ patients }, null, 2));
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
- Medications: ${(p.medications || []).map(m => m.name + ' ' + m.dose + ' ' + (m.frequency || '')).join(', ')}

YOUR CAPABILITIES:
1. DOCUMENT ANALYSIS - Read uploaded medical documents, prescriptions, insurance cards, lab results
2. ACTION PLANS - Step-by-step plans with exact phone scripts
3. APPEAL LETTERS - Draft formal insurance appeals with medical necessity arguments
4. EMAIL SENDING - Draft and send real emails (use EMAIL_DRAFT format below)
5. PHONE CALLS - Trigger real phone calls to providers (use CALL_REQUEST format below)
6. CALENDAR - Detect appointment dates and suggest adding to Google Calendar (use CALENDAR_EVENT format)
7. MEDICATION MANAGEMENT - Track meds, check interactions, refill reminders
8. INSURANCE TRACKING - Track claims, denials, appeals
9. MEDICAL TRANSLATION - Explain medical jargon in plain English
10. APPOINTMENT PREP - Checklists and questions to ask

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
- You are an advocate for the patient — fight hard for their care`;
}

// ─── Google OAuth2 Setup ────────────────────────────────────
let oauth2Client = null;
let googleTokens = null;

if (google && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
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
app.get('/api/chat-history', (req, res) => {
  res.json({ sessions: loadChatHistory() });
});

app.get('/api/chat-history/:id', (req, res) => {
  const data = loadChatHistory();
  const session = data.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

app.delete('/api/chat-history/:id', (req, res) => {
  try {
    let data = { sessions: loadChatHistory() };
    data.sessions = data.sessions.filter(s => s.id !== req.params.id);
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/save-chat', (req, res) => {
  const { messages, patientId } = req.body;
  if (!messages?.length) return res.json({ success: false });
  const id = saveChatSession(patientId || getCurrentPatientId(), messages);
  res.json({ success: true, id });
});

// ─── Notifications ──────────────────────────────────────────
app.get('/api/notifications', (req, res) => {
  res.json(loadNotifications());
});

app.post('/api/notifications/read/:id', (req, res) => {
  const data = loadNotifications();
  const notif = data.notifications.find(n => n.id === req.params.id);
  if (notif) notif.read = true;
  saveNotifications(data);
  res.json({ success: true });
});

app.post('/api/notifications/read-all', (req, res) => {
  const data = loadNotifications();
  data.notifications.forEach(n => n.read = true);
  saveNotifications(data);
  res.json({ success: true });
});

app.delete('/api/notifications/:id', (req, res) => {
  const data = loadNotifications();
  data.notifications = data.notifications.filter(n => n.id !== req.params.id);
  saveNotifications(data);
  res.json({ success: true });
});

app.post('/api/notifications/add', (req, res) => {
  const { type, title, message, patientId, dueDate } = req.body;
  const notif = addNotification(type, title, message, patientId, dueDate);
  res.json({ success: true, notification: notif });
});

// ─── Patients (Multi-patient) ───────────────────────────────
app.get('/api/patients', (req, res) => {
  res.json({ patients: getAllPatients() });
});

app.get('/api/patients/current', (req, res) => {
  const id = getCurrentPatientId();
  const patients = getAllPatients();
  const patient = patients.find(p => p.id === id) || patients[0];
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
      newPatient.id = newPatient.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
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
    const idx = patients.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Patient not found' });
    patients[idx] = { ...patients[idx], ...req.body };
    saveAllPatients(patients);
    res.json({ success: true, patient: patients[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Legacy patient endpoint (for sidebar card)
app.get('/api/patient', (req, res) => {
  const currentPatientId = getCurrentPatientId();
  const patients = getAllPatients();
  const patient = patients.find(p => p.id === currentPatientId) || patients[0];
  res.json(patient || {});
});

// Also support the old /api/patient/:id format
app.get('/api/patient/:id', (req, res) => {
  const patients = getAllPatients();
  const patient = patients.find(p => p.id === req.params.id);
  res.json(patient || { error: 'not found' });
});

app.put('/api/patient/:id', (req, res) => {
  try {
    const patients = getAllPatients();
    const idx = patients.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Patient not found' });
    patients[idx] = { ...patients[idx], ...req.body };
    saveAllPatients(patients);
    res.json(patients[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Chat (main) ────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, patientId } = req.body;
  const lower = message.toLowerCase().trim();

  // Handle confirm for pending profile updates
  if (lower === 'confirm' && pendingUpdates) {
    try {
      const patients = getAllPatients();
      const idx = patients.findIndex(p => p.id === pendingUpdates.id);
      if (idx >= 0) {
        patients[idx] = { ...patients[idx], ...pendingUpdates.updates };
        saveAllPatients(patients);
      }
      pendingUpdates = null;
      return res.json({ reply: '✅ Patient profile updated successfully!' });
    } catch (e) {
      return res.json({ reply: '❌ Error updating profile: ' + e.message });
    }
  }

  if ((lower === 'deny' || lower === 'cancel') && pendingUpdates) {
    pendingUpdates = null;
    return res.json({ reply: 'Updates cancelled. No changes were made.' });
  }

  // Handle send for pending email
  if (lower === 'send' && pendingEmailDraft) {
    try {
      await emailTools.sendRealEmail(
        pendingEmailDraft.to,
        pendingEmailDraft.subject,
        pendingEmailDraft.body
      );
      const sentTo = pendingEmailDraft.to;
      pendingEmailDraft = null;
      return res.json({ reply: '✅ **Email sent successfully!** Delivered to ' + sentTo });
    } catch (e) {
      pendingEmailDraft = null;
      return res.json({ reply: '❌ Failed to send email: ' + e.message });
    }
  }

  // Handle confirm for pending call
  if (lower === 'confirm call' && pendingCallRequest) {
    try {
      const callResult = await voice.startPhoneCall(
        pendingCallRequest.phone,
        pendingCallRequest.reason
      );
      const callName = pendingCallRequest.name;
      pendingCallRequest = null;
      return res.json({
        reply: '📞 Calling ' + callName + ' now... Call ID: ' + (callResult.callId || callResult.id || 'started'),
        callId: callResult.callId || callResult.id
      });
    } catch (e) {
      pendingCallRequest = null;
      return res.json({ reply: '❌ Failed to start call: ' + e.message });
    }
  }

  if (lower === 'cancel call' && pendingCallRequest) {
    pendingCallRequest = null;
    return res.json({ reply: 'Call cancelled.' });
  }

  // Get current patient
  const currentPatientId = patientId || getCurrentPatientId();
  const patients = getAllPatients();
  const patient = patients.find(p => p.id === currentPatientId) || patients[0];

  conversationHistory.push({ role: 'user', content: message });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: buildSystemPrompt(patient),
      messages: conversationHistory
    });

    const reply = response.content[0].text;
    conversationHistory.push({ role: 'assistant', content: reply });

    // Detect EMAIL_DRAFT
    const emailMatch = reply.match(/EMAIL_DRAFT:(\{[\s\S]*?\})/);
    if (emailMatch) {
      try {
        pendingEmailDraft = JSON.parse(emailMatch[1]);
        emailTools.saveDraft(pendingEmailDraft.to, pendingEmailDraft.subject, pendingEmailDraft.body);
      } catch (e) {
        console.log('Email draft parse error:', e.message);
      }
    }

    // Detect CALL_REQUEST
    const callMatch = reply.match(/CALL_REQUEST:(\{[\s\S]*?\})/);
    if (callMatch) {
      try {
        pendingCallRequest = JSON.parse(callMatch[1]);
        return res.json({
          reply: reply.replace(/CALL_REQUEST:\{[\s\S]*?\}/, '').trim(),
          callRequest: pendingCallRequest
        });
      } catch (e) {
        console.log('Call request parse error:', e.message);
      }
    }

    // Detect CALENDAR_EVENT
    const calMatch = reply.match(/CALENDAR_EVENT:(\{[\s\S]*?\})/);
    let calendarEvent = null;
    if (calMatch) {
      try {
        calendarEvent = JSON.parse(calMatch[1]);
      } catch (e) {}
    }

    // Auto-detect medication refill mentions and create notifications
    if (reply.toLowerCase().includes('refill') || reply.toLowerCase().includes('prescription')) {
      addNotification(
        'medication',
        'Medication Refill Reminder',
        'Chat mention: ' + message.substring(0, 80),
        currentPatientId,
        null
      );
    }

    res.json({
      reply: reply.replace(/CALENDAR_EVENT:\{[\s\S]*?\}/, '').trim(),
      calendarEvent,
      hasPendingEmail: !!pendingEmailDraft,
      hasPendingCall: !!pendingCallRequest
    });
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Upload / Vision ─────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const currentPatientId = getCurrentPatientId();
  const patients = getAllPatients();
  const patient = patients.find(p => p.id === currentPatientId) || patients[0];

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
        text: 'Analyze this medical document for patient ' +
              (patient?.name || 'the patient') +
              '. Identify the document_type (insurance_card, insurance_denial, lab_result, prescription, medical_bill, imaging_order, doctor_note, referral, unknown). Extract all medical information and return EXTRACTED_DATA:{json} including document_type, name, dob, insurance, medications, conditions, doctors, and key medical details. Then explain what the document means and what actions should be taken.'
      }
    ]
  }];

} else if (mime === 'application/pdf') {
    } else if (mime === 'application/pdf') {
      // Convert PDF pages to images, then send through Vision
      try {
        const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
        const { createCanvas } = require('canvas');
        throw new Error('skip-canvas');
      } catch(canvasErr) {
        // Canvas not available — send PDF as document to Claude (works for text PDFs)
        // For scanned PDFs, try raw document approach first
        try {
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
                text: 'This is a PDF document for patient ' + (patient.name || 'the patient') + '. It may be a scanned document. Read EVERY word you can see including headers, body text, handwriting, stamps, signatures, dates, phone numbers, fax numbers, addresses, and medical terminology.\n\nExtract all medical information. Return a JSON object with fields: name, dob, address, insurance, medications, conditions, allergies, doctors, pharmacy, appointments, referrals, orders.\nOnly include fields you can clearly read. Format as: EXTRACTED_DATA:{json}\n\nAlso explain what type of document this is (lab result, prescription, insurance card, referral, order, denial letter, bill, etc.) and what specific actions should be taken next.'
              }
            ]
          }];
        } catch(e) {
          console.log('PDF read error:', e.message);
          messages = [{ role: 'user', content: 'A PDF was uploaded but could not be processed. Ask the user to take a clear photo of the document instead.' }];
        }
      }

 
    } else {
     let rawText;

  

      let text;
      try { text = fs.readFileSync(filePath, 'utf-8').substring(0, 5000); } catch (e) { text = '[Could not read file]'; }
      messages = [{ role: 'user', content: text + '\n\nAnalyze this document. Extract medical info as EXTRACTED_DATA:{json}.' }];
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: buildSystemPrompt(patient),
      messages
    });

    const text = response.content[0].text;

// Auto-create a simple timeline event from uploaded documents
try {
  const timelineData = loadTimeline();
  const title = req.file.originalname || 'Uploaded Medical Document';
  const exists = (timelineData.events || []).some(e =>
    e.title === title &&
    e.patientId === currentPatientId
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
    fs.writeFileSync(TIMELINE_FILE, JSON.stringify(timelineData, null, 2));
  }
} catch (e) {
  console.log('Timeline save error:', e.message);
}

// Auto-create a basic follow-up task from uploaded documents
try {
  tasksTools.addTask({
    patientId: currentPatientId,
    title: 'Review uploaded document',
    description: (req.file.originalname || 'Medical document') + ' was uploaded and may need follow-up.',
    dueDate: null,
    priority: 'medium',
    category: 'records',
    source: req.file.originalname || 'upload'
  });
} catch (e) {
  console.log('Task auto-create error:', e.message);
}
// Auto-create an active concern from uploaded documents
try {
  let concernTitle = 'Document review pending';
  let concernDescription = (req.file.originalname || 'Medical document') + ' was uploaded and may need follow-up.';

  if (match) {
    try {
      const extracted = JSON.parse(match[1]);
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
      }
    } catch (e) {}
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

        const match = text.match(/EXTRACTED_DATA:(\{[\s\S]*\})/);

    if (match) {
      try {
        const extracted = JSON.parse(match[1]);
        pendingUpdates = {
          id: currentPatientId,
          updates: extracted,
          raw: text
        };
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.json({
          success: true,
          extracted,
          message: 'Review the extracted data. Type "confirm" to save or "deny" to cancel.',
          pending: true
        });
      } catch (e) {
        console.log('Extract parse error:', e.message);
      }
    }

    try { fs.unlinkSync(filePath); } catch (e) {}
    res.json({ success: true, message: text, pending: false });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error('Upload error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Voice Calls ────────────────────────────────────────────
app.post('/api/call', async (req, res) => {
  try {
    const { phone, phoneNumber, reason } = req.body;
    const number = phone || phoneNumber;
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

// ─── Email ───────────────────────────────────────────────────
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, body, htmlBody } = req.body;
    const emailBody = htmlBody || body;
    await emailTools.sendRealEmail(to, subject, emailBody);
    res.json({ success: true, message: 'Email sent successfully!' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/drafts', (req, res) => {
  try {
    const drafts = emailTools.listDrafts();
    res.json({ drafts });
  } catch (e) {
    res.json({ drafts: [] });
  }
});

// ─── Google Calendar OAuth ───────────────────────────────────
app.get('/auth/google', (req, res) => {
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
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    res.send('<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>✅ Google Calendar Connected!</h2><p>You can now add events from the chat.</p><script>setTimeout(() => window.close(), 2000)</script></body></html>');
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

app.get('/api/calendar/status', (req, res) => {
  res.json({ connected: !!googleTokens });
});

app.post('/api/calendar/add-event', async (req, res) => {
  if (!googleTokens || !oauth2Client) {
    return res.status(401).json({ error: 'Google Calendar not connected. Visit /auth/google first.' });
  }

  try {
    const { title, date, time, duration, description } = req.body;
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startDateTime = new Date(date + 'T' + (time || '09:00') + ':00');
    const endDateTime = new Date(startDateTime.getTime() + (duration || 60) * 60000);

    const event = {
      summary: title,
      description: description || '',
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Chicago' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Chicago' },
    };

    const result = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });

    addNotification(
      'appointment',
      'Appointment Added: ' + title,
      'Added to Google Calendar: ' + date + ' at ' + (time || '9:00 AM'),
      getCurrentPatientId(),
      date
    );

    res.json({ success: true, eventId: result.data.id, link: result.data.htmlLink });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/calendar/events', (req, res) => {
  try {
    const events = calendarTools.listEvents ? calendarTools.listEvents() : [];
    res.json({ events });
  } catch (e) {
    res.json({ events: [] });
  }
});
// ─── ICS Calendar Fallback (Universal Calendar Support) ───────
app.get('/api/calendar/ics', (req, res) => {
  try {
    const { title, date, time, duration, description } = req.query;

    if (!title || !date) {
      return res.status(400).send('Missing title or date');
    }

    const start = new Date(date + 'T' + (time || '09:00') + ':00');
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
      'SUMMARY:' + safeTitle,
      'DESCRIPTION:' + safeDescription,
      'DTSTART:' + formatICSDate(start),
      'DTEND:' + formatICSDate(end),
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
// ─── Tasks API ──────────────────────────────────────────────

app.get('/api/tasks', (req, res) => {
  try {
    const patientId = getCurrentPatientId();
    const tasks = tasksTools.listTasks(patientId);
    res.json({ tasks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const patientId = getCurrentPatientId();
    const task = tasksTools.addTask({
      ...req.body,
      patientId
    });
    res.json({ success: true, task });
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
// ─── Timeline API ───────────────────────────────────────────

app.get('/api/timeline', (req, res) => {
  try {
    const patientId = getCurrentPatientId();
    const data = loadTimeline();
    const events = (data.events || []).filter(e => e.patientId === patientId || !e.patientId);
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Brief API ──────────────────────────────────────────────

app.get('/api/brief', (req, res) => {
  try {
    const patientId = getCurrentPatientId();
    const patient = getAllPatients().find(p => p.id === patientId) || getAllPatients()[0] || {};
    const timeline = loadTimeline();
    const recentTimeline = (timeline.events || [])
      .filter(e => e.patientId === patientId || !e.patientId)
      .slice(0, 10);

    const openTasks = tasksTools.listTasks(patientId).filter(t => t.status !== 'done');

    res.json({
      patient,
      recentTimeline,
      openTasks
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Dashboard ──────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const patient = getAllPatients().find(p => p.id === getCurrentPatientId());
  res.json({
    patient,
    appointments: appointmentsTools.listUpcoming ? appointmentsTools.listUpcoming() : [],
    medications: medicationsTools.getMedications ? medicationsTools.getMedications() : [],
    drafts: emailTools.listDrafts(),
    notifications: loadNotifications()
  });
});
// ─── Active Concerns ─────────────────────────────────────────
app.get('/api/concerns', (req, res) => {
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
    const patientId = getCurrentPatientId();
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

app.get('/api/pending', (req, res) => res.json(pendingUpdates));

// ─── Static pages ───────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/settings', (req, res) => {
  const settingsPath = path.join(__dirname, 'public', 'settings.html');
  if (fs.existsSync(settingsPath)) res.sendFile(settingsPath);
  else res.redirect('/');
});
app.get('/timeline', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'timeline.html'));
});

app.get('/tasks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tasks.html'));
});

app.get('/brief', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'brief.html'));
});

app.get('/playbooks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'playbooks.html'));
});

// ─── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🏥 Health Agent running on http://localhost:' + PORT);
  console.log('📅 Google Calendar: ' + (googleTokens ? '✅ Connected' : '⚠️  Not connected — visit /auth/google'));
  console.log('🔔 Notifications: ' + NOTIFICATIONS_FILE);
  console.log('💬 Chat history: ' + CHAT_HISTORY_FILE + '\n');
});