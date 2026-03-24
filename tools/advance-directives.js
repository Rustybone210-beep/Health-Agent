const fs = require("fs");
const path = require("path");
const DIRECTIVES_FILE = path.join(__dirname, "..", "data", "advance_directives.json");

const DOCUMENT_TYPES = {
  living_will: {
    name: "Living Will",
    description: "States your wishes for medical treatment if you become unable to communicate",
    fields: ["fullName", "dateOfBirth", "lifeSustaining", "artificialNutrition", "painManagement", "organDonation", "additionalWishes"],
    prompts: {
      lifeSustaining: "If I am terminally ill or permanently unconscious, I want life-sustaining treatments to be:",
      artificialNutrition: "Regarding tube feeding and IV fluids:",
      painManagement: "Regarding pain management:",
      organDonation: "Regarding organ and tissue donation:"
    },
    options: {
      lifeSustaining: ["Continue all treatments", "Withdraw treatments and allow natural death", "Trial period then withdraw if no improvement"],
      artificialNutrition: ["Continue feeding", "Discontinue if no chance of recovery", "No artificial nutrition or hydration"],
      painManagement: ["Keep comfortable with all available medications, even if it may hasten death", "Standard pain management only"],
      organDonation: ["I wish to donate any needed organs and tissues", "I wish to donate only specific organs", "I do not wish to donate"]
    }
  },
  healthcare_poa: {
    name: "Healthcare Power of Attorney",
    description: "Names someone to make medical decisions for you if you cannot",
    fields: ["fullName", "dateOfBirth", "agentName", "agentRelationship", "agentPhone", "agentAddress", "alternateAgentName", "alternateAgentPhone", "limitations", "effectiveWhen"]
  },
  dnr: {
    name: "Do Not Resuscitate (DNR)",
    description: "Instructs medical personnel not to perform CPR if your heart stops",
    fields: ["fullName", "dateOfBirth", "physicianName", "physicianPhone", "reason", "witnesses"]
  },
  hipaa_release: {
    name: "HIPAA Authorization",
    description: "Allows specific people to access your medical records",
    fields: ["fullName", "dateOfBirth", "authorizedPersons", "scope", "expirationDate"]
  }
};

function loadDirectives() {
  try {
    if (!fs.existsSync(DIRECTIVES_FILE)) return [];
    return JSON.parse(fs.readFileSync(DIRECTIVES_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveDirectives(directives) {
  fs.writeFileSync(DIRECTIVES_FILE, JSON.stringify(directives, null, 2));
}

function createDirective(patientId, type, data) {
  const template = DOCUMENT_TYPES[type];
  if (!template) throw new Error("Unknown document type: " + type);
  const directives = loadDirectives();
  const directive = {
    id: Date.now().toString(),
    patientId,
    type,
    typeName: template.name,
    description: template.description,
    data: data || {},
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    signedAt: null,
    witnesses: [],
    notes: ""
  };
  directives.push(directive);
  saveDirectives(directives);
  return directive;
}

function updateDirective(directiveId, updates) {
  const directives = loadDirectives();
  const d = directives.find(x => x.id === directiveId);
  if (!d) return null;
  if (updates.data) d.data = { ...d.data, ...updates.data };
  if (updates.status) d.status = updates.status;
  if (updates.notes) d.notes = updates.notes;
  if (updates.witnesses) d.witnesses = updates.witnesses;
  if (updates.status === "signed") d.signedAt = new Date().toISOString();
  d.updatedAt = new Date().toISOString();
  saveDirectives(directives);
  return d;
}

function getDirectives(patientId) {
  return loadDirectives().filter(d => d.patientId === patientId);
}

function getDocumentTypes() {
  return Object.entries(DOCUMENT_TYPES).map(([key, doc]) => ({
    id: key,
    name: doc.name,
    description: doc.description,
    fieldCount: doc.fields.length,
    prompts: doc.prompts || null,
    options: doc.options || null
  }));
}

function generateDirectiveText(directive) {
  const d = directive.data || {};
  let text = "";
  text += directive.typeName.toUpperCase() + "\n";
  text += "=".repeat(50) + "\n\n";
  text += "Patient: " + (d.fullName || "________________") + "\n";
  text += "Date of Birth: " + (d.dateOfBirth || "________________") + "\n";
  text += "Date: " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) + "\n\n";

  if (directive.type === "living_will") {
    text += "DECLARATION\n\n";
    text += "I, " + (d.fullName || "________________") + ", being of sound mind, declare the following wishes regarding my medical care:\n\n";
    if (d.lifeSustaining) text += "LIFE-SUSTAINING TREATMENT: " + d.lifeSustaining + "\n\n";
    if (d.artificialNutrition) text += "ARTIFICIAL NUTRITION AND HYDRATION: " + d.artificialNutrition + "\n\n";
    if (d.painManagement) text += "PAIN MANAGEMENT: " + d.painManagement + "\n\n";
    if (d.organDonation) text += "ORGAN DONATION: " + d.organDonation + "\n\n";
    if (d.additionalWishes) text += "ADDITIONAL WISHES: " + d.additionalWishes + "\n\n";
  } else if (directive.type === "healthcare_poa") {
    text += "APPOINTMENT OF HEALTHCARE AGENT\n\n";
    text += "I appoint " + (d.agentName || "________________") + " as my healthcare agent.\n";
    text += "Relationship: " + (d.agentRelationship || "________________") + "\n";
    text += "Phone: " + (d.agentPhone || "________________") + "\n";
    text += "Address: " + (d.agentAddress || "________________") + "\n\n";
    if (d.alternateAgentName) {
      text += "ALTERNATE AGENT: " + d.alternateAgentName + "\n";
      text += "Phone: " + (d.alternateAgentPhone || "________________") + "\n\n";
    }
    if (d.limitations) text += "LIMITATIONS: " + d.limitations + "\n\n";
  } else if (directive.type === "hipaa_release") {
    text += "HIPAA AUTHORIZATION FOR RELEASE OF HEALTH INFORMATION\n\n";
    text += "I authorize the following persons to access my medical records:\n\n";
    if (d.authorizedPersons) {
      const persons = Array.isArray(d.authorizedPersons) ? d.authorizedPersons : [d.authorizedPersons];
      persons.forEach((p, i) => { text += (i + 1) + ". " + p + "\n"; });
    }
    text += "\nScope: " + (d.scope || "All medical records") + "\n";
    text += "Expires: " + (d.expirationDate || "Upon revocation") + "\n\n";
  }

  text += "=".repeat(50) + "\n";
  text += "Signature: ________________________________  Date: ____________\n\n";
  text += "Witness 1: ________________________________  Date: ____________\n";
  text += "Witness 2: ________________________________  Date: ____________\n\n";
  text += "IMPORTANT: This document was generated by Health Agent as a starting point.\n";
  text += "Consult an attorney to ensure it meets your state's legal requirements.\n";
  text += "This document must be signed, witnessed, and/or notarized to be legally valid.\n";
  return text;
}

module.exports = { createDirective, updateDirective, getDirectives, getDocumentTypes, generateDirectiveText, DOCUMENT_TYPES };
