const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname,'../data/visit_recordings.json');

function load() {
  try { if(!fs.existsSync(DATA_FILE)) return []; return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch(e) { return []; }
}
function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2)); }

function createVisit(patientId, doctorName, visitType, date) {
  const visits = load();
  const visit = {
    id: Date.now().toString(),
    patientId,
    doctorName: doctorName || 'Unknown Doctor',
    visitType: visitType || 'General',
    date: date || new Date().toISOString().split('T')[0],
    status: 'pending',
    transcript: null,
    summary: null,
    prescriptions: [],
    followUps: [],
    testsOrdered: [],
    questionsAnswered: [],
    createdAt: new Date().toISOString()
  };
  visits.unshift(visit);
  save(visits);
  return visit;
}

function saveTranscript(visitId, transcript) {
  const visits = load();
  const idx = visits.findIndex(v => v.id === visitId);
  if(idx === -1) throw new Error('Visit not found');
  visits[idx].transcript = transcript;
  visits[idx].status = 'transcribed';
  save(visits);
  return visits[idx];
}

function saveSummary(visitId, summary) {
  const visits = load();
  const idx = visits.findIndex(v => v.id === visitId);
  if(idx === -1) throw new Error('Visit not found');
  visits[idx] = { ...visits[idx], ...summary, status: 'summarized' };
  save(visits);
  return visits[idx];
}

function getVisits(patientId) {
  return load().filter(v => v.patientId === patientId);
}

function getVisit(visitId) {
  return load().find(v => v.id === visitId) || null;
}

function buildSummaryPrompt(transcript) {
  return `You are a medical scribe. Analyze this doctor visit transcript and extract:
1. WHAT WAS DISCUSSED: Main topics covered
2. NEW PRESCRIPTIONS: Any new medications prescribed (name, dose, frequency)
3. MEDICATION CHANGES: Any existing medications changed or stopped
4. TESTS ORDERED: Lab work, imaging, referrals ordered
5. FOLLOW-UP INSTRUCTIONS: What to do next, when to return
6. QUESTIONS ANSWERED: Patient questions and doctor's answers
7. KEY CONCERNS: Anything the doctor flagged as important

Transcript:
${transcript}

Respond in JSON format:
{
  "summary": "2-3 sentence overview",
  "prescriptions": [{"name":"","dose":"","frequency":"","reason":""}],
  "medicationChanges": [{"medication":"","change":"","reason":""}],
  "testsOrdered": [{"test":"","reason":"","urgency":""}],
  "followUps": [{"action":"","timeframe":"","reason":""}],
  "questionsAnswered": [{"question":"","answer":""}],
  "keyConcerns": [""]
}`;
}

module.exports = { createVisit, saveTranscript, saveSummary, getVisits, getVisit, buildSummaryPrompt };
