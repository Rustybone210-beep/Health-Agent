const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname,'../data/med_changes.json');

function load() {
  try { if(!fs.existsSync(DATA_FILE)) return []; return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch(e) { return []; }
}
function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2)); }

function logChange(patientId, medication, changeType, oldDose, newDose, reason, prescriber) {
  const changes = load();
  const entry = { id: Date.now().toString(), patientId, medication, changeType, oldDose, newDose, reason: reason||'', prescriber: prescriber||'', date: new Date().toISOString().split('T')[0], timestamp: new Date().toISOString(), impacts: [], symptoms: [] };
  changes.unshift(entry);
  save(changes);
  return entry;
}

function addImpact(changeId, impact, severity, date) {
  const changes = load();
  const idx = changes.findIndex(c => c.id === changeId);
  if(idx === -1) throw new Error('Change not found');
  changes[idx].impacts = changes[idx].impacts || [];
  changes[idx].impacts.push({ impact, severity, date: date||new Date().toISOString().split('T')[0], loggedAt: new Date().toISOString() });
  save(changes);
  return changes[idx];
}

function getChanges(patientId, medication) {
  const changes = load().filter(c => c.patientId === patientId);
  if(medication) return changes.filter(c => c.medication.toLowerCase().includes(medication.toLowerCase()));
  return changes;
}

function generateImpactReport(patientId) {
  const changes = getChanges(patientId);
  if(!changes.length) return { hasData: false, changes: [], summary: 'No medication changes logged yet.' };
  const report = changes.map(c => {
    const daysSince = Math.floor((Date.now() - new Date(c.timestamp)) / (1000*60*60*24));
    let summary = '';
    if(c.medication.toLowerCase().includes('synthroid') || c.medication.toLowerCase().includes('levothyroxine')) {
      summary = 'Thyroid medication changes affect: weight, energy, dry eye severity, cholesterol, meibomian gland function. Monitor for 6-8 weeks.';
    } else if(c.medication.toLowerCase().includes('metformin')) {
      summary = 'Metformin changes affect: blood sugar control, A1c, GI tolerance. Monitor labs in 3 months.';
    } else if(c.medication.toLowerCase().includes('lisinopril')) {
      summary = 'Lisinopril changes affect: blood pressure, kidney function, potassium levels. Monitor BP daily for 2 weeks.';
    }
    return { ...c, daysSince, summary, impactCount: (c.impacts||[]).length };
  });
  return { hasData: true, changes: report, total: changes.length, withImpacts: changes.filter(c => (c.impacts||[]).length > 0).length };
}

module.exports = { logChange, addImpact, getChanges, generateImpactReport };
