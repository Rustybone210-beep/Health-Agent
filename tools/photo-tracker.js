const fs = require("fs");
const path = require("path");
const PHOTO_LOG_FILE = path.join(__dirname, "..", "data", "photo_log.json");

function loadPhotoLog() {
  try { if (!fs.existsSync(PHOTO_LOG_FILE)) return []; return JSON.parse(fs.readFileSync(PHOTO_LOG_FILE, "utf8")); } catch(e) { return []; }
}
function savePhotoLog(log) { fs.writeFileSync(PHOTO_LOG_FILE, JSON.stringify(log.slice(-500), null, 2)); }

function logPhoto({ patientId, bodyArea, condition, fileName, filePath, notes, severity, aiAnalysis }) {
  const log = loadPhotoLog();
  const entry = {
    id: Date.now().toString(),
    patientId,
    bodyArea: bodyArea || "unspecified",
    condition: condition || "",
    fileName: fileName || "",
    filePath: filePath || "",
    notes: notes || "",
    severity: severity || null,
    aiAnalysis: aiAnalysis || null,
    date: new Date().toISOString().split("T")[0],
    timestamp: new Date().toISOString()
  };
  log.push(entry);
  savePhotoLog(log);
  return entry;
}

function getPhotoHistory(patientId, bodyArea, days) {
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  let photos = loadPhotoLog().filter(p => p.patientId === patientId);
  if (bodyArea) photos = photos.filter(p => p.bodyArea.toLowerCase().includes(bodyArea.toLowerCase()));
  if (cutoff) photos = photos.filter(p => new Date(p.timestamp).getTime() >= cutoff);
  return photos.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function getProgressReport(patientId, bodyArea) {
  const photos = getPhotoHistory(patientId, bodyArea);
  if (photos.length < 2) return { message: "Need at least 2 photos to show progress", photos };
  const first = photos[0];
  const last = photos[photos.length - 1];
  const daysBetween = Math.round((new Date(last.timestamp) - new Date(first.timestamp)) / (24 * 60 * 60 * 1000));
  return {
    bodyArea: bodyArea || "all areas",
    totalPhotos: photos.length,
    firstPhoto: first.date,
    lastPhoto: last.date,
    daysBetween,
    photos,
    severityTrend: photos.filter(p => p.severity).map(p => ({ date: p.date, severity: p.severity })),
    message: photos.length + " photos over " + daysBetween + " days for " + (bodyArea || "all areas")
  };
}

module.exports = { logPhoto, getPhotoHistory, getProgressReport };
