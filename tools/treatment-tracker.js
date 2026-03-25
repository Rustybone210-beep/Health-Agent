const fs = require("fs");
const path = require("path");
const TREATMENTS_FILE = path.join(__dirname, "..", "data", "treatment_history.json");

function loadTreatments() {
  try { if (!fs.existsSync(TREATMENTS_FILE)) return []; return JSON.parse(fs.readFileSync(TREATMENTS_FILE, "utf8")); } catch(e) { return []; }
}
function saveTreatments(t) { fs.writeFileSync(TREATMENTS_FILE, JSON.stringify(t, null, 2)); }

function addTreatment({ patientId, category, name, prescriber, startDate, dose, frequency, reason, cost, coveredByInsurance, notes }) {
  const treatments = loadTreatments();
  const t = {
    id: Date.now().toString(),
    patientId,
    category: category || "medication",
    name: name || "",
    prescriber: prescriber || "",
    startDate: startDate || new Date().toISOString().split("T")[0],
    endDate: null,
    dose: dose || "",
    frequency: frequency || "",
    reason: reason || "",
    cost: cost || "",
    coveredByInsurance: coveredByInsurance || null,
    status: "active",
    effectiveness: null,
    sideEffects: [],
    stoppedReason: null,
    notes: notes || "",
    timeline: [{ date: new Date().toISOString(), event: "Started", details: "" }],
    createdAt: new Date().toISOString()
  };
  treatments.push(t);
  saveTreatments(treatments);
  return t;
}

function updateTreatment(treatmentId, updates) {
  const treatments = loadTreatments();
  const t = treatments.find(x => x.id === treatmentId);
  if (!t) return null;
  if (updates.event) {
    t.timeline.push({ date: new Date().toISOString(), event: updates.event, details: updates.eventDetails || "" });
    delete updates.event; delete updates.eventDetails;
  }
  Object.assign(t, updates);
  saveTreatments(treatments);
  return t;
}

function stopTreatment(treatmentId, reason, effectiveness, endDate) {
  const treatments = loadTreatments();
  const t = treatments.find(x => x.id === treatmentId);
  if (!t) return null;
  t.status = "stopped";
  t.stoppedReason = reason || "";
  t.effectiveness = effectiveness || null;
  t.endDate = endDate || new Date().toISOString().split("T")[0];
  t.timeline.push({ date: new Date().toISOString(), event: "Stopped", details: reason || "" });
  saveTreatments(treatments);
  return t;
}

function addSideEffect(treatmentId, sideEffect, severity, date) {
  const treatments = loadTreatments();
  const t = treatments.find(x => x.id === treatmentId);
  if (!t) return null;
  t.sideEffects.push({ effect: sideEffect, severity: severity || "moderate", date: date || new Date().toISOString().split("T")[0] });
  t.timeline.push({ date: new Date().toISOString(), event: "Side effect", details: sideEffect });
  saveTreatments(treatments);
  return t;
}

function getTreatments(patientId, status) {
  let all = loadTreatments().filter(t => t.patientId === patientId);
  if (status) all = all.filter(t => t.status === status);
  return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getTreatmentsByCategory(patientId, category) {
  return loadTreatments().filter(t => t.patientId === patientId && t.category === category);
}

function generateTreatmentReport(patientId) {
  const all = loadTreatments().filter(t => t.patientId === patientId);
  const active = all.filter(t => t.status === "active");
  const stopped = all.filter(t => t.status === "stopped");
  const categories = {};
  all.forEach(t => {
    if (!categories[t.category]) categories[t.category] = { active: [], stopped: [], total: 0 };
    categories[t.category].total++;
    if (t.status === "active") categories[t.category].active.push(t);
    else categories[t.category].stopped.push(t);
  });
  const failedTreatments = stopped.filter(t => t.effectiveness === "ineffective" || t.effectiveness === "made_worse");
  return {
    totalTreatments: all.length,
    active: active.length,
    stopped: stopped.length,
    categories,
    failedTreatments,
    sideEffectHistory: stopped.filter(t => t.sideEffects.length > 0).map(t => ({
      treatment: t.name,
      effects: t.sideEffects,
      stoppedBecause: t.stoppedReason
    })),
    summary: active.length + " active treatments, " + stopped.length + " previously tried. " +
      failedTreatments.length + " treatments failed or made things worse."
  };
}

module.exports = { addTreatment, updateTreatment, stopTreatment, addSideEffect, getTreatments, getTreatmentsByCategory, generateTreatmentReport };
