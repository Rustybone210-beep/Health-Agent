const https = require("https");
const fs = require("fs");
const path = require("path");
const EHR_CONFIG_FILE = path.join(__dirname, "..", "data", "ehr_config.json");

const SUPPORTED_EHRS = {
  epic: {
    name: "Epic MyChart",
    fhirBase: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
    authUrl: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize",
    tokenUrl: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
    scopes: "patient/*.read launch/patient openid fhirUser",
    description: "Connect to Epic MyChart to pull medications, allergies, lab results, and conditions",
    setupSteps: [
      "Register your app at fhir.epic.com",
      "Get client_id and set redirect_uri",
      "Patient authorizes access through MyChart login",
      "System pulls records automatically"
    ]
  },
  cerner: {
    name: "Cerner/Oracle Health",
    fhirBase: "https://fhir-open.cerner.com/r4",
    authUrl: "https://authorization.cerner.com/tenants/",
    tokenUrl: "https://authorization.cerner.com/tenants/",
    scopes: "patient/Patient.read patient/Condition.read patient/MedicationRequest.read patient/AllergyIntolerance.read patient/Observation.read",
    description: "Connect to Cerner to access hospital records",
    setupSteps: [
      "Register at code.cerner.com",
      "Get client credentials",
      "Patient authorizes through hospital portal",
      "System pulls records automatically"
    ]
  }
};

const FHIR_RESOURCES = {
  patient: "Patient",
  conditions: "Condition",
  medications: "MedicationRequest",
  allergies: "AllergyIntolerance",
  labs: "Observation?category=laboratory",
  vitals: "Observation?category=vital-signs",
  procedures: "Procedure",
  immunizations: "Immunization",
  documents: "DocumentReference"
};

function getEHRConfig() {
  try {
    if (fs.existsSync(EHR_CONFIG_FILE)) return JSON.parse(fs.readFileSync(EHR_CONFIG_FILE, "utf8"));
  } catch (e) {}
  return { connections: [], configured: false };
}

function saveEHRConfig(config) {
  fs.writeFileSync(EHR_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getSupportedEHRs() {
  return Object.entries(SUPPORTED_EHRS).map(([key, ehr]) => ({
    id: key,
    name: ehr.name,
    description: ehr.description,
    setupSteps: ehr.setupSteps,
    connected: getEHRConfig().connections?.some(c => c.ehr === key && c.active) || false
  }));
}

function initiateConnection(ehrType, clientId, redirectUri) {
  const ehr = SUPPORTED_EHRS[ehrType];
  if (!ehr) throw new Error("Unsupported EHR: " + ehrType);
  const state = require("crypto").randomBytes(16).toString("hex");
  const authUrl = ehr.authUrl +
    "?response_type=code" +
    "&client_id=" + encodeURIComponent(clientId) +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=" + encodeURIComponent(ehr.scopes) +
    "&state=" + state +
    "&aud=" + encodeURIComponent(ehr.fhirBase);
  const config = getEHRConfig();
  config.pendingAuth = { ehr: ehrType, state, clientId, redirectUri, initiatedAt: new Date().toISOString() };
  saveEHRConfig(config);
  return { authUrl, state };
}

async function fetchFHIRResource(baseUrl, resource, accessToken, patientId) {
  return new Promise((resolve, reject) => {
    let url = baseUrl + "/" + resource;
    if (patientId && !resource.includes("?")) url += "?patient=" + patientId;
    else if (patientId) url += "&patient=" + patientId;

    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Accept": "application/fhir+json"
      }
    };

    https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Failed to parse FHIR response")); }
      });
    }).on("error", reject).end();
  });
}

function convertFHIRToPatientData(fhirBundle, resourceType) {
  const entries = (fhirBundle.entry || []).map(e => e.resource).filter(Boolean);
  switch (resourceType) {
    case "Condition":
      return entries.map(e => ({
        condition: e.code?.text || e.code?.coding?.[0]?.display || "Unknown",
        status: e.clinicalStatus?.coding?.[0]?.code || "active",
        onsetDate: e.onsetDateTime || e.onsetPeriod?.start || null
      }));
    case "MedicationRequest":
      return entries.map(e => ({
        name: e.medicationCodeableConcept?.text || e.medicationCodeableConcept?.coding?.[0]?.display || "Unknown",
        dose: e.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity?.value + " " + (e.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity?.unit || "") || "",
        frequency: e.dosageInstruction?.[0]?.text || "",
        status: e.status || "active",
        prescriber: e.requester?.display || ""
      }));
    case "AllergyIntolerance":
      return entries.map(e => ({
        allergen: e.code?.text || e.code?.coding?.[0]?.display || "Unknown",
        reaction: (e.reaction || []).map(r => r.manifestation?.[0]?.text || r.description || "").filter(Boolean).join(", "),
        severity: e.reaction?.[0]?.severity || "unknown"
      }));
    default:
      return entries;
  }
}

function getConnectionStatus() {
  const config = getEHRConfig();
  return {
    configured: config.configured || false,
    connections: (config.connections || []).map(c => ({
      ehr: c.ehr,
      ehrName: SUPPORTED_EHRS[c.ehr]?.name || c.ehr,
      active: c.active,
      lastSync: c.lastSync,
      connectedAt: c.connectedAt
    })),
    availableEHRs: getSupportedEHRs()
  };
}

module.exports = { getSupportedEHRs, initiateConnection, fetchFHIRResource, convertFHIRToPatientData, getConnectionStatus, FHIR_RESOURCES, SUPPORTED_EHRS };
