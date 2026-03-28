// ============================================================
// sms-agent.js — SMS interface for Health Agent via Twilio
//
// Users text the Health Agent number, get AI responses back.
// Phone number linked to their account for patient context.
// ============================================================

const Anthropic = require('@anthropic-ai/sdk').default;

const PHONE_LINKS_FILE = require('path').join(__dirname, '..', 'data', 'phone_links.json');
const fs = require('fs');

function loadPhoneLinks() {
  try {
    if (!fs.existsSync(PHONE_LINKS_FILE)) return {};
    return JSON.parse(fs.readFileSync(PHONE_LINKS_FILE, 'utf8'));
  } catch (e) { return {}; }
}

function savePhoneLinks(links) {
  fs.writeFileSync(PHONE_LINKS_FILE, JSON.stringify(links, null, 2));
  try { require('./cloud-storage').syncAfterWrite('phone_links.json'); } catch(e) {}
}

function linkPhoneToAccount(phoneNumber, userId) {
  const links = loadPhoneLinks();
  links[phoneNumber] = { userId, linkedAt: new Date().toISOString() };
  savePhoneLinks(links);
  return true;
}

function getUserIdFromPhone(phoneNumber) {
  const links = loadPhoneLinks();
  return links[phoneNumber]?.userId || null;
}

async function handleIncomingSMS(from, body, { getAllPatientsRaw, getCurrentPatientId, getPatientsForUser, buildSystemPrompt }) {
  const userId = getUserIdFromPhone(from);
  if (!userId) {
    return {
      response: "Welcome to Health Agent! To use SMS, first link your phone number in the app: Settings > Link Phone Number. Visit healthagentcare.com to get started.",
      linked: false
    };
  }

  const patients = getPatientsForUser(userId);
  const patientId = getCurrentPatientId(userId);
  const patient = patients.find(p => p.id === patientId) || patients[0] || {};

  if (!patient.name) {
    return {
      response: "You haven't set up a patient profile yet. Visit healthagentcare.com to add your first patient.",
      linked: true
    };
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = buildSystemPrompt(patient) +
      '\n\nIMPORTANT: You are responding via SMS text message. Keep responses SHORT — under 160 characters when possible, max 320 characters. Be concise but helpful. No markdown formatting. No bullet points. Plain text only.';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: body }]
    });

    const reply = response.content?.[0]?.text || "I'm here to help. Try asking about medications, appointments, or insurance.";
    return { response: reply, linked: true, patient: patient.name };
  } catch (e) {
    return { response: "Sorry, I'm having trouble right now. Please try again in a moment.", linked: true, error: e.message };
  }
}

async function sendSMS(to, message) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    console.log('[SMS] Twilio not configured');
    return false;
  }
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    return true;
  } catch (e) {
    console.error('[SMS] Send failed:', e.message);
    return false;
  }
}

module.exports = { handleIncomingSMS, sendSMS, linkPhoneToAccount, getUserIdFromPhone };
