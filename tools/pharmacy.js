const fs = require("fs");
const path = require("path");
const REFILL_FILE = path.join(__dirname, "..", "data", "refill_requests.json");

function loadRefills() {
  try {
    if (!fs.existsSync(REFILL_FILE)) return [];
    return JSON.parse(fs.readFileSync(REFILL_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveRefills(refills) {
  fs.writeFileSync(REFILL_FILE, JSON.stringify(refills, null, 2));
}

function createRefillRequest({ patientId, medication, dose, rxNumber, pharmacyName, pharmacyPhone, prescriber, urgent, notes }) {
  const refills = loadRefills();
  const request = {
    id: Date.now().toString(),
    patientId,
    medication: medication || "",
    dose: dose || "",
    rxNumber: rxNumber || "",
    pharmacyName: pharmacyName || "",
    pharmacyPhone: pharmacyPhone || "",
    prescriber: prescriber || "",
    urgent: urgent || false,
    notes: notes || "",
    status: "pending",
    callScript: buildCallScript(medication, dose, rxNumber, pharmacyName, prescriber),
    onlineRefillLinks: buildRefillLinks(pharmacyName, rxNumber),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  refills.push(request);
  saveRefills(refills);
  return request;
}

function buildCallScript(medication, dose, rxNumber, pharmacyName, prescriber) {
  return {
    pharmacyScript: [
      "Hi, I'm calling to request a refill for " + (medication || "a medication") + (dose ? " " + dose : "") + ".",
      rxNumber ? "The prescription number is " + rxNumber + "." : "I don't have the Rx number handy.",
      "The patient is Linda Fields.",
      "Can you tell me when it will be ready and if there are any issues with refills remaining?",
      "If there are no refills, can you contact " + (prescriber || "the prescribing doctor") + " for authorization?"
    ],
    doctorScript: [
      "Hi, I'm calling on behalf of Linda Fields, a patient of " + (prescriber || "the doctor") + ".",
      "She needs a new prescription for " + (medication || "her medication") + (dose ? " " + dose : "") + ".",
      "Her pharmacy is " + (pharmacyName || "on file") + ".",
      "Can the doctor send the prescription electronically today?"
    ]
  };
}

function buildRefillLinks(pharmacyName, rxNumber) {
  const links = [];
  const pn = (pharmacyName || "").toLowerCase();
  if (pn.includes("walgreens")) {
    links.push({ name: "Walgreens Refill", url: "https://www.walgreens.com/rx-refill", icon: "💊" });
  }
  if (pn.includes("cvs")) {
    links.push({ name: "CVS Refill", url: "https://www.cvs.com/rx/refill", icon: "💊" });
  }
  if (pn.includes("walmart")) {
    links.push({ name: "Walmart Pharmacy", url: "https://www.walmart.com/pharmacy", icon: "💊" });
  }
  if (pn.includes("heb") || pn.includes("h-e-b")) {
    links.push({ name: "H-E-B Pharmacy", url: "https://www.heb.com/pharmacy", icon: "💊" });
  }
  links.push({ name: "GoodRx Price Check", url: "https://www.goodrx.com/", icon: "💰" });
  links.push({ name: "Cost Plus Drugs", url: "https://costplusdrugs.com/", icon: "💰" });
  return links;
}

function updateRefillStatus(refillId, status, notes) {
  const refills = loadRefills();
  const r = refills.find(x => x.id === refillId);
  if (!r) return null;
  r.status = status;
  if (notes) r.notes = (r.notes ? r.notes + "\n" : "") + notes;
  r.updatedAt = new Date().toISOString();
  saveRefills(refills);
  return r;
}

function getPendingRefills(patientId) {
  return loadRefills().filter(r => r.patientId === patientId && r.status === "pending");
}

function getRefillHistory(patientId) {
  return loadRefills().filter(r => r.patientId === patientId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { createRefillRequest, updateRefillStatus, getPendingRefills, getRefillHistory, buildCallScript, buildRefillLinks };
