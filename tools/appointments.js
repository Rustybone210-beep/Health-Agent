const fs = require("fs");
const path = require("path");

const apptFile = path.join(__dirname, "..", "data", "appointments.json");
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

function getAppointments() {
  if (!fs.existsSync(apptFile)) return [];
  return JSON.parse(fs.readFileSync(apptFile, "utf-8"));
}

function addAppointment(appt) {
  const appts = getAppointments();
  appt.id = Date.now().toString();
  appt.createdDate = new Date().toISOString();
  appt.status = "scheduled";
  appts.push(appt);
  fs.writeFileSync(apptFile, JSON.stringify(appts, null, 2));
  return appt;
}

function listUpcoming() {
  const now = new Date();
  return getAppointments().filter(a => new Date(a.date) >= now).sort((a, b) => new Date(a.date) - new Date(b.date));
}

module.exports = { getAppointments, addAppointment, listUpcoming };
