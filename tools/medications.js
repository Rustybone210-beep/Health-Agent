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
  if (med.refillDate) med.refillDate = med.refillDate;
  if (med.pharmacy) med.pharmacy = med.pharmacy;
  if (med.prescriber) med.prescriber = med.prescriber;
  if (med.rxNumber) med.rxNumber = med.rxNumber;
  meds.push(med);
  fs.writeFileSync(medFile, JSON.stringify(meds, null, 2));
  return med;
}
function updateMedication(id, updates) {
  const meds = getMedications();
  const idx = meds.findIndex(m => m.id === id);
  if (idx >= 0) {
    Object.assign(meds[idx], updates, { updatedDate: new Date().toISOString() });
    fs.writeFileSync(medFile, JSON.stringify(meds, null, 2));
    return meds[idx];
  }
  return null;
}
function removeMedication(id) {
  let meds = getMedications();
  meds = meds.filter(m => m.id !== id);
  fs.writeFileSync(medFile, JSON.stringify(meds, null, 2));
  return meds;
}
function getMedsNeedingRefill(daysAhead) {
  const meds = getMedications();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + (daysAhead || 7));
  return meds.filter(m => {
    if (!m.refillDate) return false;
    return new Date(m.refillDate) <= cutoff;
  });
}

module.exports = { getMedications, addMedication, updateMedication, removeMedication, getMedsNeedingRefill };
