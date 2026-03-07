const fs = require("fs");
const path = require("path");

const patientsFile = path.join(__dirname, "..", "data", "patients.json");
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const defaultPatient = {
  id: "maria-fields",
  name: "Maria Fields",
  relationship: "Mother",
  dob: "04/12/1955",
  age: 70,
  phone: "",
  address: "",
  emergencyContact: { name: "J Fields", phone: "", relationship: "Son" },
  doctors: [
    { name: "Dr. Martinez", specialty: "Primary Care", office: "Alamo Heights Family Medicine", phone: "", fax: "", portal: "", notes: "Routine visits every 3 months" }
  ],
  insurance: {
    provider: "United Healthcare", plan: "Choice Plus PPO", memberId: "", groupNumber: "", phone: "1-800-444-9137", portalUrl: "https://www.uhc.com/member", copay: { office: "$30", specialist: "$50", imaging: "$75", er: "$250" }
  },
  pharmacy: { name: "H-E-B Pharmacy", location: "Huebner Rd", phone: "", transferRx: false },
  medications: [
    { name: "Lisinopril", dose: "10mg", frequency: "daily", prescriber: "Dr. Martinez", purpose: "Blood pressure", refillDate: "", pharmacy: "H-E-B" },
    { name: "Metformin", dose: "500mg", frequency: "twice daily", prescriber: "Dr. Martinez", purpose: "Type 2 Diabetes", refillDate: "", pharmacy: "H-E-B" },
    { name: "Vitamin D3", dose: "2000IU", frequency: "daily", prescriber: "Dr. Martinez", purpose: "Supplement", refillDate: "", pharmacy: "H-E-B" }
  ],
  conditions: ["Hypertension", "Type 2 Diabetes", "Pulmonary nodule (monitoring)"],
  allergies: ["Penicillin", "Sulfa drugs"],
  surgeries: [],
  familyHistory: [],
  preferredHospital: "Methodist Hospital",
  preferredLanguage: "English",
  visits: [
    { date: "2/1/26", doctor: "Dr. Martinez", type: "Routine follow-up", notes: "" },
    { date: "1/15/26", doctor: "Radiology", type: "Chest X-ray", notes: "Pulmonary nodule noted, CT follow-up recommended" }
  ],
  documents: [],
  portalAccess: []
};

function getPatients() {
  if (!fs.existsSync(patientsFile)) {
    fs.writeFileSync(patientsFile, JSON.stringify([defaultPatient], null, 2));
    return [defaultPatient];
  }
  return JSON.parse(fs.readFileSync(patientsFile, "utf-8"));
}

function getPatient(id) {
  const patients = getPatients();
  return patients.find(p => p.id === id) || null;
}

function updatePatient(id, updates) {
  const patients = getPatients();
  const idx = patients.findIndex(p => p.id === id);
  if (idx >= 0) {
    patients[idx] = { ...patients[idx], ...updates };
    fs.writeFileSync(patientsFile, JSON.stringify(patients, null, 2));
    return patients[idx];
  }
  return null;
}

function addPatient(patient) {
  const patients = getPatients();
  patient.id = patient.name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
  patient.documents = [];
  patient.visits = [];
  patient.portalAccess = [];
  patients.push(patient);
  fs.writeFileSync(patientsFile, JSON.stringify(patients, null, 2));
  return patient;
}

function addDoctor(patientId, doctor) {
  const patients = getPatients();
  const idx = patients.findIndex(p => p.id === patientId);
  if (idx >= 0) {
    patients[idx].doctors.push(doctor);
    fs.writeFileSync(patientsFile, JSON.stringify(patients, null, 2));
    return patients[idx];
  }
  return null;
}

function addVisit(patientId, visit) {
  const patients = getPatients();
  const idx = patients.findIndex(p => p.id === patientId);
  if (idx >= 0) {
    visit.id = Date.now().toString();
    patients[idx].visits.unshift(visit);
    fs.writeFileSync(patientsFile, JSON.stringify(patients, null, 2));
    return visit;
  }
  return null;
}

function addPortalAccess(patientId, portal) {
  const patients = getPatients();
  const idx = patients.findIndex(p => p.id === patientId);
  if (idx >= 0) {
    patients[idx].portalAccess.push(portal);
    fs.writeFileSync(patientsFile, JSON.stringify(patients, null, 2));
    return patients[idx];
  }
  return null;
}

module.exports = { getPatients, getPatient, updatePatient, addPatient, addDoctor, addVisit, addPortalAccess };
