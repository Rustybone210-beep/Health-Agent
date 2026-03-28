// ============================================================
// patient-intake.js — Universal Patient Intake Form Auto-Fill
//
// One patient profile → fills every portal registration form.
// Scan once, enter once, populate everywhere.
//
// Supports: MyChart, Athena, FollowMyHealth, generic portals
// Generates: pre-filled data packets, clipboard-ready values,
//            QR codes for kiosk intake
// ============================================================

const fs = require('fs');
const path = require('path');

const INTAKE_FILE = path.join(__dirname, '..', 'data', 'intake_profiles.json');

function loadProfiles() {
  try {
    if (!fs.existsSync(INTAKE_FILE)) return {};
    return JSON.parse(fs.readFileSync(INTAKE_FILE, 'utf8'));
  } catch (e) { return {}; }
}

function saveProfiles(profiles) {
  fs.writeFileSync(INTAKE_FILE, JSON.stringify(profiles, null, 2));
  try { require('./cloud-storage').syncAfterWrite('intake_profiles.json'); } catch(e) {}
}

/**
 * Build a complete intake profile from patient data
 * This is the MASTER record that maps to any portal
 */
function buildIntakeProfile(patient) {
  const p = patient || {};
  const nameParts = (p.name || '').split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const middleName = nameParts.length > 2 ? nameParts[1] : '';

  // Parse address
  const addrParts = (p.address || '').split(',').map(s => s.trim());
  const street = addrParts[0] || '';
  const city = addrParts[1] || '';
  const stateZip = (addrParts[2] || '').trim().split(' ');
  const state = stateZip[0] || '';
  const zip = stateZip[1] || '';

  // Parse DOB
  const dobParts = (p.dob || '').split('/');
  const dobMonth = dobParts[0] || '';
  const dobDay = dobParts[1] || '';
  const dobYear = dobParts[2] || '';
  const age = p.dob ? Math.floor((Date.now() - new Date(p.dob).getTime()) / 31557600000) : '';

  return {
    // Demographics
    firstName,
    lastName,
    middleName,
    fullName: p.name || '',
    dateOfBirth: p.dob || '',
    dobMonth, dobDay, dobYear,
    age: String(age),
    gender: p.gender || '',
    sex: p.sex || p.gender || '',
    ssn: p.ssn || '',
    maritalStatus: p.maritalStatus || '',
    race: p.race || '',
    ethnicity: p.ethnicity || '',
    preferredLanguage: p.preferredLanguage || 'English',

    // Contact
    phone: p.phone || '',
    cellPhone: p.cellPhone || p.phone || '',
    homePhone: p.homePhone || '',
    workPhone: p.workPhone || '',
    email: p.email || '',

    // Address
    address: p.address || '',
    streetAddress: street,
    city,
    state,
    zipCode: zip,
    country: 'US',

    // Emergency Contact
    emergencyContactName: p.emergencyContact?.name || '',
    emergencyContactPhone: p.emergencyContact?.phone || '',
    emergencyContactRelation: p.emergencyContact?.relationship || '',

    // Insurance — Primary
    insurancePrimary: p.insurance?.primary || '',
    insurancePrimaryId: p.insurance?.memberId || '',
    insurancePrimaryGroup: p.insurance?.groupNumber || '',
    insurancePrimaryPhone: p.insurance?.phone || '',
    insurancePolicyHolder: p.name || '',
    insurancePolicyHolderDob: p.dob || '',
    insurancePolicyHolderRelation: 'Self',

    // Insurance — Secondary
    insuranceSecondary: p.insurance?.secondary || '',
    insuranceSecondaryId: p.insurance?.secondaryMemberId || '',
    insuranceSecondaryGroup: p.insurance?.secondaryGroupNumber || '',

    // Medical
    primaryDoctor: p.primaryDoctor || '',
    primaryDoctorPhone: p.doctorPhone || '',
    clinic: p.clinic || '',
    referringDoctor: p.referringDoctor || '',
    preferredPharmacy: p.pharmacy?.name || '',
    pharmacyPhone: p.pharmacy?.phone || '',
    pharmacyAddress: p.pharmacy?.address || '',

    // Medical History
    conditions: (p.conditions || []).join(', '),
    conditionsList: p.conditions || [],
    medications: (p.medications || []).map(m => m.name + ' ' + (m.dose || '') + ' ' + (m.frequency || '')).join(', '),
    medicationsList: p.medications || [],
    allergies: (p.allergies || []).join(', '),
    allergiesList: p.allergies || [],
    surgicalHistory: (p.surgicalHistory || []).join(', '),
    familyHistory: p.familyHistory || '',

    // Preferences
    preferredHospital: p.preferredHospital || '',
    advanceDirective: p.advanceDirective || false,
    organDonor: p.organDonor || false,

    // Relationship (caregiver context)
    relationship: p.relationship || p.relation || '',

    // Timestamps
    profileUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Map patient data to specific portal field names
 */
const PORTAL_MAPPINGS = {
  mychart: {
    'patient_first_name': 'firstName',
    'patient_last_name': 'lastName',
    'patient_middle_name': 'middleName',
    'patient_dob': 'dateOfBirth',
    'patient_sex': 'sex',
    'patient_ssn': 'ssn',
    'street_address': 'streetAddress',
    'city': 'city',
    'state': 'state',
    'zip': 'zipCode',
    'home_phone': 'homePhone',
    'cell_phone': 'cellPhone',
    'email': 'email',
    'emergency_name': 'emergencyContactName',
    'emergency_phone': 'emergencyContactPhone',
    'emergency_relationship': 'emergencyContactRelation',
    'insurance_name': 'insurancePrimary',
    'insurance_id': 'insurancePrimaryId',
    'insurance_group': 'insurancePrimaryGroup',
    'pcp_name': 'primaryDoctor',
    'pharmacy_name': 'preferredPharmacy',
    'pharmacy_phone': 'pharmacyPhone',
    'allergies': 'allergies',
    'medications': 'medications',
    'conditions': 'conditions',
  },
  athena: {
    'FirstName': 'firstName',
    'LastName': 'lastName',
    'DOB': 'dateOfBirth',
    'Sex': 'sex',
    'SSN': 'ssn',
    'Address1': 'streetAddress',
    'City': 'city',
    'State': 'state',
    'Zip': 'zipCode',
    'HomePhone': 'homePhone',
    'MobilePhone': 'cellPhone',
    'Email': 'email',
    'PrimaryInsurance': 'insurancePrimary',
    'InsuranceID': 'insurancePrimaryId',
    'GroupNumber': 'insurancePrimaryGroup',
    'SecondaryInsurance': 'insuranceSecondary',
    'SecondaryInsuranceID': 'insuranceSecondaryId',
    'PCP': 'primaryDoctor',
    'ReferringProvider': 'referringDoctor',
    'Pharmacy': 'preferredPharmacy',
    'Allergies': 'allergies',
    'Medications': 'medications',
    'MedicalHistory': 'conditions',
  },
  generic: {
    'first_name': 'firstName',
    'last_name': 'lastName',
    'date_of_birth': 'dateOfBirth',
    'gender': 'gender',
    'phone': 'phone',
    'address': 'address',
    'insurance': 'insurancePrimary',
    'member_id': 'insurancePrimaryId',
    'doctor': 'primaryDoctor',
    'allergies': 'allergies',
    'medications': 'medications',
  },
};

/**
 * Get portal-specific mapped data
 */
function getPortalData(patient, portalType = 'generic') {
  const profile = buildIntakeProfile(patient);
  const mapping = PORTAL_MAPPINGS[portalType] || PORTAL_MAPPINGS.generic;
  const mapped = {};

  for (const [portalField, profileField] of Object.entries(mapping)) {
    mapped[portalField] = profile[profileField] || '';
  }

  return { mapped, fullProfile: profile, portalType };
}

/**
 * Generate a clipboard-ready list of all fields
 */
function getClipboardData(patient) {
  const profile = buildIntakeProfile(patient);
  const sections = [
    { title: 'DEMOGRAPHICS', fields: [
      ['Full Name', profile.fullName],
      ['Date of Birth', profile.dateOfBirth],
      ['Age', profile.age],
      ['Gender', profile.gender],
      ['Phone', profile.phone],
      ['Email', profile.email],
      ['Address', profile.address],
    ]},
    { title: 'INSURANCE — PRIMARY', fields: [
      ['Insurance', profile.insurancePrimary],
      ['Member ID', profile.insurancePrimaryId],
      ['Group #', profile.insurancePrimaryGroup],
    ]},
    { title: 'INSURANCE — SECONDARY', fields: [
      ['Insurance', profile.insuranceSecondary],
      ['Member ID', profile.insuranceSecondaryId],
    ]},
    { title: 'MEDICAL', fields: [
      ['Primary Doctor', profile.primaryDoctor],
      ['Clinic', profile.clinic],
      ['Pharmacy', profile.preferredPharmacy],
      ['Pharmacy Phone', profile.pharmacyPhone],
    ]},
    { title: 'CONDITIONS', fields: [
      ['Conditions', profile.conditions],
    ]},
    { title: 'MEDICATIONS', fields: [
      ['Medications', profile.medications],
    ]},
    { title: 'ALLERGIES', fields: [
      ['Allergies', profile.allergies],
    ]},
    { title: 'EMERGENCY CONTACT', fields: [
      ['Name', profile.emergencyContactName],
      ['Phone', profile.emergencyContactPhone],
      ['Relationship', profile.emergencyContactRelation],
    ]},
  ];

  return { sections, fullProfile: profile };
}

/**
 * Save extended intake data that goes beyond basic patient profile
 */
function saveIntakeExtras(patientId, extras) {
  const profiles = loadProfiles();
  profiles[patientId] = { ...profiles[patientId], ...extras, updatedAt: new Date().toISOString() };
  saveProfiles(profiles);
  return profiles[patientId];
}

function getIntakeExtras(patientId) {
  const profiles = loadProfiles();
  return profiles[patientId] || {};
}

module.exports = {
  buildIntakeProfile,
  getPortalData,
  getClipboardData,
  saveIntakeExtras,
  getIntakeExtras,
  PORTAL_MAPPINGS,
};
