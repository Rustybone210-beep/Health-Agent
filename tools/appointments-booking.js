const fs = require("fs");
const path = require("path");
const APPTS_FILE = path.join(__dirname, "..", "data", "appointments.json");

function loadAppointments() {
  try {
    if (!fs.existsSync(APPTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(APPTS_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveAppointments(appts) {
  fs.writeFileSync(APPTS_FILE, JSON.stringify(appts, null, 2));
}

function createAppointment({ patientId, ownerId, doctorName, clinic, specialty, date, time, duration, reason, phone, address, notes, insurance, status }) {
  const appts = loadAppointments();
  const appt = {
    id: Date.now().toString(),
    patientId,
    ownerId: ownerId || null,
    doctorName: doctorName || "",
    clinic: clinic || "",
    specialty: specialty || "",
    date: date || "",
    time: time || "09:00",
    duration: duration || 60,
    reason: reason || "",
    phone: phone || "",
    address: address || "",
    notes: notes || "",
    insurance: insurance || "",
    status: status || "scheduled",
    remindersSet: false,
    prepChecklist: [],
    questionsToAsk: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  appts.push(appt);
  saveAppointments(appts);
  return appt;
}

function getUpcoming(patientId, days) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + (days || 90) * 24 * 60 * 60 * 1000);
  const today = now.toISOString().split("T")[0];
  return loadAppointments()
    .filter(a => a.patientId === patientId && a.date >= today && a.date <= cutoff.toISOString().split("T")[0] && a.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

function getPast(patientId, days) {
  const cutoff = new Date(Date.now() - (days || 365) * 24 * 60 * 60 * 1000);
  const today = new Date().toISOString().split("T")[0];
  return loadAppointments()
    .filter(a => a.patientId === patientId && a.date < today && a.date >= cutoff.toISOString().split("T")[0])
    .sort((a, b) => b.date.localeCompare(a.date));
}

function updateAppointment(apptId, updates) {
  const appts = loadAppointments();
  const idx = appts.findIndex(a => a.id === apptId);
  if (idx === -1) return null;
  Object.assign(appts[idx], updates, { updatedAt: new Date().toISOString() });
  saveAppointments(appts);
  return appts[idx];
}

function cancelAppointment(apptId, reason) {
  return updateAppointment(apptId, { status: "cancelled", cancelReason: reason || "", cancelledAt: new Date().toISOString() });
}

function addPrepItem(apptId, item) {
  const appts = loadAppointments();
  const appt = appts.find(a => a.id === apptId);
  if (!appt) return null;
  if (!appt.prepChecklist) appt.prepChecklist = [];
  appt.prepChecklist.push({ text: item, done: false, addedAt: new Date().toISOString() });
  saveAppointments(appts);
  return appt;
}

function addQuestion(apptId, question) {
  const appts = loadAppointments();
  const appt = appts.find(a => a.id === apptId);
  if (!appt) return null;
  if (!appt.questionsToAsk) appt.questionsToAsk = [];
  appt.questionsToAsk.push({ text: question, answered: false, addedAt: new Date().toISOString() });
  saveAppointments(appts);
  return appt;
}

function generatePrepChecklist(appt, patient) {
  const items = [];
  items.push("Bring photo ID and insurance card");
  items.push("Bring current medication list");
  if (patient?.allergies?.length > 0) items.push("Confirm allergy list: " + patient.allergies.join(", "));
  items.push("Arrive 15 minutes early for paperwork");
  items.push("Bring a list of questions for the doctor");
  if (appt.specialty === "lab" || appt.reason?.toLowerCase().includes("lab")) {
    items.push("Confirm fasting requirements (usually 8-12 hours before blood draw)");
    items.push("Drink plenty of water the night before");
  }
  if (appt.specialty === "imaging" || appt.reason?.toLowerCase().includes("ct") || appt.reason?.toLowerCase().includes("mri")) {
    items.push("Remove all jewelry and metal before the scan");
    items.push("Check if contrast dye will be used — if yes, stop Metformin 48 hours before");
    items.push("Wear comfortable clothing with no metal zippers or buttons");
  }
  if (appt.reason?.toLowerCase().includes("surgery") || appt.reason?.toLowerCase().includes("procedure")) {
    items.push("Confirm NPO (nothing by mouth) requirements");
    items.push("Arrange transportation home — no driving after sedation");
    items.push("Confirm which medications to take/skip the morning of");
  }
  return items;
}

function getTodaysAppointments(patientId) {
  const today = new Date().toISOString().split("T")[0];
  return loadAppointments().filter(a => a.patientId === patientId && a.date === today && a.status !== "cancelled");
}

function getAppointmentReminders() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];
  return loadAppointments().filter(a => (a.date === tomorrow || a.date === today) && a.status !== "cancelled" && !a.remindersSet);
}

module.exports = {
  createAppointment, getUpcoming, getPast, updateAppointment, cancelAppointment,
  addPrepItem, addQuestion, generatePrepChecklist, getTodaysAppointments, getAppointmentReminders
};
