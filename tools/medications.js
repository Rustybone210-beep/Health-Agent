const fs = require("fs");
const path = require("path");

const medFile = path.join(__dirname, "..", "data", "medications.json");
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

function getMedications() {
  if (!fs.existsSync(medFile)) return [];
  return JSON.parse(fs.readFileSync(medFile, "utf-8"));
}

function addMedication(med) {
  const meds = getMedications();
  med.addedDate = new Date().toISOString();
  med.id = Date.now().toString();
  meds.push(med);
  fs.writeFileSync(medFile, JSON.stringify(meds, null, 2));
  return med;
}

function removeMedication(id) {
  let meds = getMedications();
  meds = meds.filter(m => m.id !== id);
  fs.writeFileSync(medFile, JSON.stringify(meds, null, 2));
  return meds;
}

module.exports = { getMedications, addMedication, removeMedication };
