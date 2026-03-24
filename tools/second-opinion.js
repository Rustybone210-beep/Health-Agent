const fs = require("fs");
const path = require("path");
const OPINIONS_FILE = path.join(__dirname, "..", "data", "second_opinions.json");

function loadOpinions() {
  try {
    if (!fs.existsSync(OPINIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(OPINIONS_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveOpinions(opinions) {
  fs.writeFileSync(OPINIONS_FILE, JSON.stringify(opinions, null, 2));
}

function createRequest({ patientId, condition, currentDiagnosis, currentTreatment, question, urgency, specialtyNeeded, preferredLocation, notes }) {
  const opinions = loadOpinions();
  const request = {
    id: Date.now().toString(),
    patientId,
    condition: condition || "",
    currentDiagnosis: currentDiagnosis || "",
    currentTreatment: currentTreatment || "",
    question: question || "Is the current treatment plan appropriate?",
    urgency: urgency || "routine",
    specialtyNeeded: specialtyNeeded || "",
    preferredLocation: preferredLocation || "",
    notes: notes || "",
    status: "pending",
    documentsNeeded: generateDocumentList(condition),
    steps: generateSteps(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  opinions.push(request);
  saveOpinions(opinions);
  return request;
}

function generateDocumentList(condition) {
  const docs = [
    { name: "Recent lab results (last 6 months)", gathered: false },
    { name: "Current medication list", gathered: false },
    { name: "Allergy list", gathered: false },
    { name: "Primary doctor's notes/assessment", gathered: false },
    { name: "Surgical history", gathered: false }
  ];
  const cond = (condition || "").toLowerCase();
  if (cond.includes("eye") || cond.includes("dry") || cond.includes("mgd")) {
    docs.push({ name: "Meibography images", gathered: false });
    docs.push({ name: "Eye treatment history (IPL, drops, etc.)", gathered: false });
    docs.push({ name: "Tear osmolarity test results", gathered: false });
  }
  if (cond.includes("spine") || cond.includes("back") || cond.includes("neuropathy")) {
    docs.push({ name: "CT or MRI imaging (recent)", gathered: false });
    docs.push({ name: "Previous surgical reports", gathered: false });
    docs.push({ name: "Pain management records", gathered: false });
  }
  if (cond.includes("cancer") || cond.includes("tumor") || cond.includes("nodule")) {
    docs.push({ name: "Biopsy results", gathered: false });
    docs.push({ name: "Imaging (CT, PET, MRI)", gathered: false });
    docs.push({ name: "Pathology reports", gathered: false });
  }
  if (cond.includes("thyroid")) {
    docs.push({ name: "Thyroid ultrasound", gathered: false });
    docs.push({ name: "TSH/T4/T3 lab history", gathered: false });
    docs.push({ name: "Thyroid medication history with dose changes", gathered: false });
  }
  return docs;
}

function generateSteps() {
  return [
    { step: 1, title: "Gather medical records", description: "Collect all relevant documents, imaging, and lab results", status: "pending" },
    { step: 2, title: "Generate medical summary", description: "Health Agent will compile a complete summary for the new doctor", status: "pending" },
    { step: 3, title: "Find specialist", description: "Search for a specialist who accepts your insurance and handles your condition", status: "pending" },
    { step: 4, title: "Schedule appointment", description: "Book the consultation, bring all documents", status: "pending" },
    { step: 5, title: "Prepare questions", description: "List specific questions you want the specialist to address", status: "pending" },
    { step: 6, title: "Attend consultation", description: "Bring records, take notes, ask all questions", status: "pending" },
    { step: 7, title: "Compare opinions", description: "Review both doctors' recommendations and make an informed decision", status: "pending" }
  ];
}

function updateRequest(requestId, updates) {
  const opinions = loadOpinions();
  const r = opinions.find(x => x.id === requestId);
  if (!r) return null;
  Object.assign(r, updates, { updatedAt: new Date().toISOString() });
  saveOpinions(opinions);
  return r;
}

function updateDocumentStatus(requestId, docName, gathered) {
  const opinions = loadOpinions();
  const r = opinions.find(x => x.id === requestId);
  if (!r) return null;
  const doc = r.documentsNeeded.find(d => d.name === docName);
  if (doc) doc.gathered = gathered;
  r.updatedAt = new Date().toISOString();
  saveOpinions(opinions);
  return r;
}

function updateStepStatus(requestId, stepNum, status) {
  const opinions = loadOpinions();
  const r = opinions.find(x => x.id === requestId);
  if (!r) return null;
  const step = r.steps.find(s => s.step === stepNum);
  if (step) step.status = status;
  r.updatedAt = new Date().toISOString();
  saveOpinions(opinions);
  return r;
}

function getRequests(patientId) {
  return loadOpinions().filter(r => r.patientId === patientId);
}

module.exports = { createRequest, updateRequest, updateDocumentStatus, updateStepStatus, getRequests };
