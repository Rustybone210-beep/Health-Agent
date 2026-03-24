const fs = require("fs");
const path = require("path");
const REMINDERS_FILE = path.join(__dirname, "..", "data", "med_reminders.json");
const REMINDER_LOG_FILE = path.join(__dirname, "..", "data", "reminder_log.json");

function loadReminders() {
  try {
    if (!fs.existsSync(REMINDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(REMINDERS_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveReminders(reminders) {
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

function loadLog() {
  try {
    if (!fs.existsSync(REMINDER_LOG_FILE)) return [];
    return JSON.parse(fs.readFileSync(REMINDER_LOG_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveLog(log) {
  fs.writeFileSync(REMINDER_LOG_FILE, JSON.stringify(log.slice(-1000), null, 2));
}

function createReminder({ patientId, medication, dose, frequency, times, notes, ownerId }) {
  const reminders = loadReminders();
  const reminder = {
    id: Date.now().toString(),
    patientId,
    ownerId: ownerId || null,
    medication,
    dose: dose || "",
    frequency: frequency || "daily",
    times: times || ["08:00"],
    notes: notes || "",
    enabled: true,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    lastConfirmed: null,
    streak: 0,
    missedCount: 0
  };
  reminders.push(reminder);
  saveReminders(reminders);
  return reminder;
}

function getReminders(patientId) {
  return loadReminders().filter(r => r.patientId === patientId && r.enabled);
}

function getAllReminders() {
  return loadReminders().filter(r => r.enabled);
}

function confirmTaken(reminderId) {
  const reminders = loadReminders();
  const r = reminders.find(x => x.id === reminderId);
  if (!r) return null;
  r.lastConfirmed = new Date().toISOString();
  r.streak = (r.streak || 0) + 1;
  saveReminders(reminders);
  const log = loadLog();
  log.push({
    reminderId: r.id,
    medication: r.medication,
    patientId: r.patientId,
    action: "taken",
    timestamp: new Date().toISOString()
  });
  saveLog(log);
  return r;
}

function confirmSkipped(reminderId, reason) {
  const reminders = loadReminders();
  const r = reminders.find(x => x.id === reminderId);
  if (!r) return null;
  r.streak = 0;
  r.missedCount = (r.missedCount || 0) + 1;
  saveReminders(reminders);
  const log = loadLog();
  log.push({
    reminderId: r.id,
    medication: r.medication,
    patientId: r.patientId,
    action: "skipped",
    reason: reason || "",
    timestamp: new Date().toISOString()
  });
  saveLog(log);
  return r;
}

function deleteReminder(reminderId) {
  const reminders = loadReminders();
  const idx = reminders.findIndex(r => r.id === reminderId);
  if (idx === -1) return false;
  reminders.splice(idx, 1);
  saveReminders(reminders);
  return true;
}

function updateReminder(reminderId, updates) {
  const reminders = loadReminders();
  const r = reminders.find(x => x.id === reminderId);
  if (!r) return null;
  Object.assign(r, updates);
  saveReminders(reminders);
  return r;
}

function getDueReminders() {
  const now = new Date();
  const currentTime = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
  const today = now.toISOString().split("T")[0];
  const reminders = getAllReminders();
  return reminders.filter(r => {
    if (!r.times || !r.times.length) return false;
    const isDue = r.times.some(t => {
      const diff = timeDiffMinutes(currentTime, t);
      return diff >= 0 && diff <= 5;
    });
    if (!isDue) return false;
    if (r.lastTriggered && r.lastTriggered.startsWith(today)) {
      const lastH = parseInt(r.lastTriggered.split("T")[1].substring(0, 2));
      const nowH = now.getHours();
      if (Math.abs(lastH - nowH) < 1) return false;
    }
    return true;
  });
}

function markTriggered(reminderId) {
  const reminders = loadReminders();
  const r = reminders.find(x => x.id === reminderId);
  if (r) {
    r.lastTriggered = new Date().toISOString();
    saveReminders(reminders);
  }
}

function getAdherenceStats(patientId, days) {
  const log = loadLog();
  const cutoff = Date.now() - (days || 30) * 24 * 60 * 60 * 1000;
  const entries = log.filter(l => l.patientId === patientId && new Date(l.timestamp).getTime() >= cutoff);
  const taken = entries.filter(l => l.action === "taken").length;
  const skipped = entries.filter(l => l.action === "skipped").length;
  const total = taken + skipped;
  return {
    taken,
    skipped,
    total,
    adherenceRate: total > 0 ? Math.round((taken / total) * 100) : 100,
    period: days || 30
  };
}

function autoCreateFromPatient(patient) {
  if (!patient || !patient.medications || !patient.medications.length) return [];
  const existing = getReminders(patient.id);
  const created = [];
  for (const med of patient.medications) {
    const alreadyExists = existing.some(r =>
      r.medication.toLowerCase() === med.name.toLowerCase()
    );
    if (alreadyExists) continue;
    let times = ["08:00"];
    const freq = (med.frequency || "").toLowerCase();
    if (freq.includes("twice") || freq.includes("bid") || freq.includes("2x")) {
      times = ["08:00", "20:00"];
    } else if (freq.includes("three") || freq.includes("tid") || freq.includes("3x")) {
      times = ["08:00", "14:00", "20:00"];
    } else if (freq.includes("four") || freq.includes("qid") || freq.includes("4x")) {
      times = ["08:00", "12:00", "16:00", "20:00"];
    } else if (freq.includes("night") || freq.includes("bedtime") || freq.includes("hs")) {
      times = ["21:00"];
    } else if (freq.includes("morning")) {
      times = ["08:00"];
    }
    const reminder = createReminder({
      patientId: patient.id,
      medication: med.name,
      dose: med.dose || "",
      frequency: med.frequency || "daily",
      times,
      ownerId: patient.ownerId || null
    });
    created.push(reminder);
  }
  return created;
}

function timeDiffMinutes(current, target) {
  const [ch, cm] = current.split(":").map(Number);
  const [th, tm] = target.split(":").map(Number);
  return (ch * 60 + cm) - (th * 60 + tm);
}

module.exports = {
  createReminder, getReminders, getAllReminders, confirmTaken, confirmSkipped,
  deleteReminder, updateReminder, getDueReminders, markTriggered,
  getAdherenceStats, autoCreateFromPatient, loadReminders
};
