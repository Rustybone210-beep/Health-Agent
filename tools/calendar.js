const ical = require("ical-generator").default;
const fs = require("fs");
const path = require("path");

const calDir = path.join(__dirname, "..", "calendar");
if (!fs.existsSync(calDir)) fs.mkdirSync(calDir);

function createEvent(title, description, location, startDate, durationMinutes) {
  const cal = ical({ name: "Health Agent" });
  const start = new Date(startDate);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  cal.createEvent({
    start, end, summary: title,
    description, location,
    alarms: [{ type: "display", trigger: 3600 }]
  });

  const fileName = `event-${Date.now()}.ics`;
  const filePath = path.join(calDir, fileName);
  fs.writeFileSync(filePath, cal.toString());
  return { fileName, filePath, title, start: start.toLocaleString(), location };
}

function listEvents() {
  if (!fs.existsSync(calDir)) return [];
  return fs.readdirSync(calDir).filter(f => f.endsWith(".ics"));
}

module.exports = { createEvent, listEvents };
