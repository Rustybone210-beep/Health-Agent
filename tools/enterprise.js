// enterprise.js — Multi-tenant white-label system for health plan licensing
const fs = require('fs');
const path = require('path');

const TENANTS_FILE = path.join(__dirname,'../data/tenants.json');
const ENROLLMENTS_FILE = path.join(__dirname,'../data/enrollments.json');
const OUTCOMES_FILE = path.join(__dirname,'../data/outcomes.json');

function load(file, fb) {
  try { if(!fs.existsSync(file)) return fb; return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) { return fb; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data,null,2)); }

// ── TENANT MANAGEMENT ──
// Each health plan gets their own tenant with custom branding
const DEFAULT_TENANTS = {
  'health-agent-consumer': {
    id: 'health-agent-consumer',
    name: 'Health Agent',
    type: 'consumer',
    branding: { primaryColor:'#14b8a6', logoText:'HealthAgent', tagline:'AI-powered healthcare navigation' },
    features: { voiceCalls:true, documentScanning:true, emergencyAlerts:true, fhirSync:true, secondOpinion:true },
    plan: 'consumer',
    active: true
  }
};

function getTenant(tenantId) {
  const tenants = load(TENANTS_FILE, DEFAULT_TENANTS);
  return tenants[tenantId] || tenants['health-agent-consumer'];
}

function createTenant(tenantData) {
  const tenants = load(TENANTS_FILE, DEFAULT_TENANTS);
  const tenant = {
    id: tenantData.id || 'tenant_'+Date.now(),
    name: tenantData.name,
    type: tenantData.type || 'health_plan',
    planType: tenantData.planType || 'medicare_advantage',
    contractStartDate: tenantData.contractStartDate || new Date().toISOString().split('T')[0],
    contractEndDate: tenantData.contractEndDate || null,
    memberCount: 0,
    branding: {
      primaryColor: tenantData.primaryColor || '#14b8a6',
      logoText: tenantData.logoText || tenantData.name,
      logoUrl: tenantData.logoUrl || null,
      tagline: tenantData.tagline || 'Powered by Health Agent'
    },
    features: {
      voiceCalls: tenantData.voiceCalls !== false,
      documentScanning: tenantData.documentScanning !== false,
      emergencyAlerts: tenantData.emergencyAlerts !== false,
      fhirSync: tenantData.fhirSync !== false,
      secondOpinion: tenantData.secondOpinion !== false,
      medicareBlueButton: tenantData.medicareBlueButton || false,
      providerDirectory: tenantData.providerDirectory || false,
      drugFormulary: tenantData.drugFormulary || false
    },
    compliance: {
      hipaaBAA: tenantData.hipaaBAA || false,
      soc2: tenantData.soc2 || false,
      cmsApproved: tenantData.cmsApproved || false,
      stateApprovals: tenantData.stateApprovals || []
    },
    billing: {
      model: tenantData.billingModel || 'pmpm', // per member per month
      rate: tenantData.rate || 2.00,
      currency: 'USD'
    },
    apiKey: 'ha_tenant_'+Math.random().toString(36).substring(2,15),
    createdAt: new Date().toISOString(),
    active: true
  };
  tenants[tenant.id] = tenant;
  save(TENANTS_FILE, tenants);
  return tenant;
}

function getAllTenants() {
  return Object.values(load(TENANTS_FILE, DEFAULT_TENANTS));
}

// ── MEMBER ENROLLMENT ──
function enrollMember(tenantId, memberData) {
  const enrollments = load(ENROLLMENTS_FILE, {});
  if(!enrollments[tenantId]) enrollments[tenantId] = [];
  const enrollment = {
    id: Date.now().toString(),
    tenantId,
    memberId: memberData.memberId || memberData.medicareId,
    medicareId: memberData.medicareId || null,
    medicaidId: memberData.medicaidId || null,
    name: memberData.name,
    dob: memberData.dob,
    enrolledAt: new Date().toISOString(),
    lastActive: null,
    status: 'active',
    source: memberData.source || 'manual'
  };
  enrollments[tenantId].push(enrollment);
  save(ENROLLMENTS_FILE, enrollments);

  // Update member count
  const tenants = load(TENANTS_FILE, DEFAULT_TENANTS);
  if(tenants[tenantId]) {
    tenants[tenantId].memberCount = enrollments[tenantId].length;
    save(TENANTS_FILE, tenants);
  }
  return enrollment;
}

function getEnrollments(tenantId) {
  const enrollments = load(ENROLLMENTS_FILE, {});
  return enrollments[tenantId] || [];
}

// ── OUTCOMES TRACKING ──
// This is what gets you licensed — prove the value
function recordOutcome(tenantId, patientId, outcomeType, data) {
  const outcomes = load(OUTCOMES_FILE, {});
  if(!outcomes[tenantId]) outcomes[tenantId] = [];
  const outcome = {
    id: Date.now().toString(),
    tenantId, patientId, outcomeType,
    data,
    recordedAt: new Date().toISOString()
  };
  outcomes[tenantId].push(outcome);
  save(OUTCOMES_FILE, outcomes.slice ? outcomes : Object.fromEntries(
    Object.entries(outcomes).map(([k,v]) => [k, Array.isArray(v) ? v.slice(-1000) : v])
  ));
  return outcome;
}

function generateOutcomesReport(tenantId) {
  const outcomes = load(OUTCOMES_FILE, {})[tenantId] || [];
  const enrollments = getEnrollments(tenantId);

  const byType = {};
  outcomes.forEach(o => {
    if(!byType[o.outcomeType]) byType[o.outcomeType] = [];
    byType[o.outcomeType].push(o);
  });

  // Star Rating relevant metrics
  const report = {
    tenantId,
    reportDate: new Date().toISOString(),
    totalMembers: enrollments.length,
    activeMembers: enrollments.filter(e => e.status==='active').length,
    outcomes: {
      medicationAdherence: {
        count: (byType['medication_taken']||[]).length,
        rate: enrollments.length > 0 ? Math.round((byType['medication_taken']||[]).length / enrollments.length * 100) : 0,
        starMeasure: 'C01 Medication Adherence'
      },
      preventiveCare: {
        count: (byType['preventive_care_completed']||[]).length,
        starMeasure: 'C15 Breast Cancer Screening, C16 Colorectal Cancer'
      },
      erAvoidance: {
        count: (byType['er_avoided']||[]).length,
        estimatedSavings: (byType['er_avoided']||[]).length * 2500
      },
      appealsFiled: {
        count: (byType['appeal_filed']||[]).length,
        won: (byType['appeal_won']||[]).length,
        winRate: byType['appeal_filed']?.length > 0 ? Math.round((byType['appeal_won']||[]).length / byType['appeal_filed'].length * 100) : 0
      },
      secondOpinions: { count: (byType['second_opinion_requested']||[]).length },
      documentsScanned: { count: (byType['document_scanned']||[]).length },
      emergencyAlertsSuccessful: { count: (byType['emergency_alert_delivered']||[]).length }
    },
    estimatedROI: {
      erSavings: (byType['er_avoided']||[]).length * 2500,
      appealRecovery: (byType['appeal_won']||[]).length * 1200,
      totalSavings: ((byType['er_avoided']||[]).length * 2500) + ((byType['appeal_won']||[]).length * 1200),
      platformCost: enrollments.length * 2 * 12,
      roi: '0x'
    }
  };

  const totalSavings = report.estimatedROI.totalSavings;
  const cost = report.estimatedROI.platformCost;
  report.estimatedROI.roi = cost > 0 ? (totalSavings/cost).toFixed(1)+'x' : 'N/A';

  return report;
}

// ── CMS INTEROPERABILITY COMPLIANCE ──
function buildCMSPatientAccessResponse(patient, fhirData) {
  // CMS requires payers to expose this via FHIR R4 Patient Access API
  return {
    resourceType: 'Bundle',
    id: 'patient-access-bundle-'+Date.now(),
    type: 'searchset',
    timestamp: new Date().toISOString(),
    entry: [
      {
        resource: {
          resourceType: 'Patient',
          id: patient.id,
          name: [{ text: patient.name }],
          birthDate: patient.dob,
          address: patient.address ? [{ text: patient.address }] : [],
          identifier: patient.insurance?.memberId ? [{
            system: 'http://medicare.gov/member',
            value: patient.insurance.memberId
          }] : []
        }
      }
    ]
  };
}

// ── STAR RATINGS TRACKER ──
const STAR_MEASURES = {
  'C01': { name:'Adherence for Diabetes Medications', weight:3, category:'Drug Plan Quality' },
  'C02': { name:'Adherence for Hypertension Medications', weight:3, category:'Drug Plan Quality' },
  'C03': { name:'Adherence for Cholesterol Medications', weight:3, category:'Drug Plan Quality' },
  'D01': { name:'Getting Needed Care', weight:2, category:'Patient Experience' },
  'D02': { name:'Getting Appointments & Care Quickly', weight:2, category:'Patient Experience' },
  'D03': { name:'Customer Service', weight:2, category:'Patient Experience' },
  'C15': { name:'Breast Cancer Screening', weight:1, category:'Prevention' },
  'C16': { name:'Colorectal Cancer Screening', weight:1, category:'Prevention' },
  'C17': { name:'Annual Flu Vaccine', weight:1, category:'Prevention' },
  'C18': { name:'Monitoring Physical Activity', weight:1, category:'Prevention' }
};

function getStarMeasures() {
  return STAR_MEASURES;
}

module.exports = {
  getTenant, createTenant, getAllTenants,
  enrollMember, getEnrollments,
  recordOutcome, generateOutcomesReport,
  buildCMSPatientAccessResponse, getStarMeasures,
  STAR_MEASURES
};
