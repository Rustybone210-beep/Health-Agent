// fhir-engine.js — FHIR R4 integration for Epic, Cerner, all major EHRs
// 21st Century Cures Act mandates open API access — the law is on our side

const fs = require('fs');
const path = require('path');
const https = require('https');

const CONNECTIONS_FILE = path.join(__dirname,'../data/fhir_connections.json');
const FHIR_DATA_FILE = path.join(__dirname,'../data/fhir_data.json');

function load(file, fb) {
  try { if(!fs.existsSync(file)) return fb; return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) { return fb; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data,null,2)); }

// ── KNOWN EHR SYSTEMS ──
// These are the real FHIR endpoints for major health systems
// Patient Portal → Settings → Connected Apps → gives you the FHIR base URL
const KNOWN_EHR_SYSTEMS = {
  epic: {
    name: 'Epic MyChart',
    logo: 'https://mychart.com',
    marketShare: '70%',
    fhirVersion: 'R4',
    authType: 'SMART on FHIR',
    sandboxUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
    patientPortal: 'https://mychart.com',
    setupSteps: [
      'Log into MyChart at your health system',
      'Go to Menu → Share My Record',
      'Select "Link My Record to an App"',
      'Search for Health Agent or use our connection link',
      'Authorize access — you control what we see'
    ],
    scopes: 'patient/Patient.read patient/Observation.read patient/MedicationRequest.read patient/Condition.read patient/Immunization.read patient/AllergyIntolerance.read patient/Appointment.read patient/DiagnosticReport.read patient/DocumentReference.read',
    resources: ['Patient','Observation','MedicationRequest','Condition','Immunization','AllergyIntolerance','Appointment','DiagnosticReport','DocumentReference','Coverage']
  },
  cerner: {
    name: 'Oracle Health (Cerner)',
    marketShare: '25%',
    fhirVersion: 'R4',
    authType: 'SMART on FHIR',
    sandboxUrl: 'https://fhir-ehr-code.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d',
    patientPortal: 'https://healthelife.com',
    setupSteps: [
      'Log into your health system patient portal',
      'Navigate to Health Records or My Data',
      'Find Connected Apps or Data Sharing',
      'Authorize Health Agent',
      'Select which data to share'
    ],
    scopes: 'patient/Patient.read patient/Observation.read patient/MedicationRequest.read patient/Condition.read',
    resources: ['Patient','Observation','MedicationRequest','Condition','AllergyIntolerance','Appointment']
  },
  cms_bluebutton: {
    name: 'Medicare Blue Button 2.0',
    marketShare: '100% of Medicare patients',
    fhirVersion: 'R4',
    authType: 'OAuth2',
    baseUrl: 'https://api.bluebutton.cms.gov/v2/fhir',
    sandboxUrl: 'https://sandbox.bluebutton.cms.gov/v2/fhir',
    patientPortal: 'https://mymedicare.gov',
    setupSteps: [
      'Log into MyMedicare.gov',
      'Go to My Account → Connected Apps',
      'Find Health Agent and click Connect',
      'Review what data Health Agent can access',
      'Click Authorize'
    ],
    scopes: 'patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read',
    resources: ['Patient','Coverage','ExplanationOfBenefit'],
    notes: 'Provides complete Medicare claims history, coverage details, drug plan information'
  },
  athenahealth: {
    name: 'athenahealth',
    marketShare: '~15% outpatient',
    fhirVersion: 'R4',
    authType: 'SMART on FHIR',
    sandboxUrl: 'https://api.preview.platform.athenahealth.com/fhir/r4',
    resources: ['Patient','Observation','MedicationRequest','Condition','Appointment','AllergyIntolerance']
  },
  allscripts: {
    name: 'Allscripts / Veradigm',
    fhirVersion: 'R4',
    authType: 'SMART on FHIR',
    resources: ['Patient','Observation','MedicationRequest','Condition']
  },
  eclinicalworks: {
    name: 'eClinicalWorks',
    fhirVersion: 'R4',
    authType: 'SMART on FHIR',
    resources: ['Patient','Observation','MedicationRequest','Condition','Appointment']
  }
};

// ── CONNECTION MANAGEMENT ──
function getConnections(patientId) {
  const data = load(CONNECTIONS_FILE, {});
  return data[patientId] || [];
}

function saveConnection(patientId, connection) {
  const data = load(CONNECTIONS_FILE, {});
  if(!data[patientId]) data[patientId] = [];
  const existing = data[patientId].findIndex(c => c.system === connection.system);
  if(existing >= 0) data[patientId][existing] = { ...data[patientId][existing], ...connection };
  else data[patientId].push({ id: Date.now().toString(), ...connection, connectedAt: new Date().toISOString(), lastSync: null, status: 'connected' });
  save(CONNECTIONS_FILE, data);
  return data[patientId].find(c => c.system === connection.system);
}

function removeConnection(patientId, system) {
  const data = load(CONNECTIONS_FILE, {});
  if(data[patientId]) data[patientId] = data[patientId].filter(c => c.system !== system);
  save(CONNECTIONS_FILE, data);
}

// ── FHIR DATA FETCHER ──
// Makes authenticated FHIR API calls and normalizes the response
async function fetchFhirResource(baseUrl, accessToken, resourceType, patientId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/${resourceType}?patient=${patientId}&_count=50`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/fhir+json',
        'Content-Type': 'application/fhir+json'
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Invalid FHIR response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('FHIR request timeout')); });
    req.end();
  });
}

// ── FHIR NORMALIZER ──
// Converts raw FHIR resources into Health Agent's internal format
function normalizePatient(fhirPatient) {
  const r = fhirPatient;
  return {
    name: r.name?.[0]?.text || [r.name?.[0]?.given?.join(' '), r.name?.[0]?.family].filter(Boolean).join(' ') || 'Unknown',
    dob: r.birthDate || null,
    gender: r.gender || null,
    phone: r.telecom?.find(t => t.system === 'phone')?.value || null,
    email: r.telecom?.find(t => t.system === 'email')?.value || null,
    address: r.address?.[0] ? [r.address[0].line?.join(' '), r.address[0].city, r.address[0].state, r.address[0].postalCode].filter(Boolean).join(', ') : null,
    mrn: r.identifier?.find(i => i.type?.coding?.[0]?.code === 'MR')?.value || null,
    source: 'fhir'
  };
}

function normalizeConditions(fhirBundle) {
  if(!fhirBundle?.entry) return [];
  return fhirBundle.entry
    .map(e => e.resource)
    .filter(r => r?.resourceType === 'Condition' && r?.clinicalStatus?.coding?.[0]?.code === 'active')
    .map(r => ({
      name: r.code?.text || r.code?.coding?.[0]?.display || 'Unknown condition',
      icd10: r.code?.coding?.find(c => c.system?.includes('icd'))?.code || null,
      onsetDate: r.onsetDateTime || r.onsetPeriod?.start || null,
      source: 'fhir'
    }));
}

function normalizeMedications(fhirBundle) {
  if(!fhirBundle?.entry) return [];
  return fhirBundle.entry
    .map(e => e.resource)
    .filter(r => r?.resourceType === 'MedicationRequest' && r?.status === 'active')
    .map(r => ({
      name: r.medicationCodeableConcept?.text || r.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown',
      rxNorm: r.medicationCodeableConcept?.coding?.find(c => c.system?.includes('rxnorm'))?.code || null,
      dose: r.dosageInstruction?.[0]?.text || null,
      frequency: r.dosageInstruction?.[0]?.timing?.repeat?.frequency ? r.dosageInstruction[0].timing.repeat.frequency + 'x/day' : null,
      prescriber: r.requester?.display || null,
      authoredOn: r.authoredOn || null,
      source: 'fhir'
    }));
}

function normalizeObservations(fhirBundle) {
  if(!fhirBundle?.entry) return [];
  return fhirBundle.entry
    .map(e => e.resource)
    .filter(r => r?.resourceType === 'Observation')
    .map(r => ({
      name: r.code?.text || r.code?.coding?.[0]?.display || 'Unknown',
      value: r.valueQuantity?.value || r.valueString || r.valueCodeableConcept?.text || null,
      unit: r.valueQuantity?.unit || null,
      date: r.effectiveDateTime || r.effectivePeriod?.start || null,
      status: r.status || null,
      category: r.category?.[0]?.coding?.[0]?.display || null,
      source: 'fhir'
    }))
    .sort((a,b) => new Date(b.date||0) - new Date(a.date||0));
}

function normalizeAllergies(fhirBundle) {
  if(!fhirBundle?.entry) return [];
  return fhirBundle.entry
    .map(e => e.resource)
    .filter(r => r?.resourceType === 'AllergyIntolerance')
    .map(r => ({
      substance: r.code?.text || r.code?.coding?.[0]?.display || 'Unknown',
      reaction: r.reaction?.[0]?.manifestation?.[0]?.text || null,
      severity: r.reaction?.[0]?.severity || null,
      status: r.clinicalStatus?.coding?.[0]?.code || 'active',
      source: 'fhir'
    }));
}

function normalizeAppointments(fhirBundle) {
  if(!fhirBundle?.entry) return [];
  return fhirBundle.entry
    .map(e => e.resource)
    .filter(r => r?.resourceType === 'Appointment' && ['booked','arrived','pending'].includes(r?.status))
    .map(r => ({
      title: r.description || r.serviceType?.[0]?.text || 'Appointment',
      date: r.start ? r.start.split('T')[0] : null,
      time: r.start ? r.start.split('T')[1]?.substring(0,5) : null,
      duration: r.minutesDuration || 30,
      status: r.status,
      provider: r.participant?.find(p => p.actor?.reference?.includes('Practitioner'))?.actor?.display || null,
      location: r.participant?.find(p => p.actor?.reference?.includes('Location'))?.actor?.display || null,
      source: 'fhir'
    }));
}

// ── FULL SYNC ──
async function syncPatientData(patientId, connection) {
  const { baseUrl, accessToken, fhirPatientId } = connection;
  const results = { synced: [], errors: [], timestamp: new Date().toISOString() };

  const resources = [
    { type:'Condition', normalizer:normalizeConditions },
    { type:'MedicationRequest', normalizer:normalizeMedications },
    { type:'Observation', normalizer:normalizeObservations },
    { type:'AllergyIntolerance', normalizer:normalizeAllergies },
    { type:'Appointment', normalizer:normalizeAppointments }
  ];

  const fhirData = load(FHIR_DATA_FILE, {});
  if(!fhirData[patientId]) fhirData[patientId] = {};

  for(const resource of resources) {
    try {
      const raw = await fetchFhirResource(baseUrl, accessToken, resource.type, fhirPatientId);
      const normalized = resource.normalizer(raw);
      fhirData[patientId][resource.type] = { data: normalized, count: normalized.length, lastSync: new Date().toISOString() };
      results.synced.push({ type: resource.type, count: normalized.length });
    } catch(e) {
      results.errors.push({ type: resource.type, error: e.message });
    }
  }

  save(FHIR_DATA_FILE, fhirData);
  return results;
}

function getFhirData(patientId, resourceType) {
  const data = load(FHIR_DATA_FILE, {});
  if(!data[patientId]) return null;
  if(resourceType) return data[patientId][resourceType] || null;
  return data[patientId];
}

function getAvailableSystems() {
  return KNOWN_EHR_SYSTEMS;
}

module.exports = {
  getConnections, saveConnection, removeConnection,
  fetchFhirResource, syncPatientData, getFhirData,
  normalizePatient, normalizeConditions, normalizeMedications,
  normalizeObservations, normalizeAllergies, normalizeAppointments,
  getAvailableSystems, KNOWN_EHR_SYSTEMS
};
