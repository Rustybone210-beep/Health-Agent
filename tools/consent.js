// ============================================================
// consent.js — Patient consent tracking for HIPAA compliance
//
// Tracks who authorized access to patient data, when, and
// what scope of access was granted. Required for HIPAA §164.508.
// ============================================================

const fs = require('fs');
const path = require('path');

const CONSENT_FILE = path.join(__dirname, '..', 'data', 'consents.json');

function load() {
  try {
    if (!fs.existsSync(CONSENT_FILE)) return [];
    return JSON.parse(fs.readFileSync(CONSENT_FILE, 'utf8'));
  } catch (e) { return []; }
}

function save(data) {
  fs.writeFileSync(CONSENT_FILE, JSON.stringify(data, null, 2));
}

/**
 * Record patient consent / authorization
 */
function recordConsent({
  patientId,
  patientName,
  authorizedBy,        // Who gave consent (patient or legal representative)
  relationship,        // 'self', 'caregiver', 'power_of_attorney', 'legal_guardian'
  scope,               // 'full', 'treatment', 'payment', 'operations'
  authorizedUsers,     // Array of user IDs/emails authorized to access
  expiresAt = null,    // Null = indefinite until revoked
  notes = null,
}) {
  const consents = load();
  const consent = {
    id: 'CONSENT-' + Date.now(),
    patientId,
    patientName,
    authorizedBy,
    relationship,
    scope,
    authorizedUsers: authorizedUsers || [],
    status: 'active',
    grantedAt: new Date().toISOString(),
    expiresAt,
    revokedAt: null,
    notes,
  };
  consents.push(consent);
  save(consents);
  return consent;
}

/**
 * Revoke consent
 */
function revokeConsent(consentId, revokedBy) {
  const consents = load();
  const idx = consents.findIndex(c => c.id === consentId);
  if (idx === -1) return null;
  consents[idx].status = 'revoked';
  consents[idx].revokedAt = new Date().toISOString();
  consents[idx].revokedBy = revokedBy;
  save(consents);
  return consents[idx];
}

/**
 * Check if a user has active consent to access a patient's data
 */
function hasConsent(patientId, userId) {
  const consents = load();
  return consents.some(c =>
    c.patientId === patientId &&
    c.status === 'active' &&
    (c.authorizedUsers.includes(userId) || c.authorizedUsers.includes('*')) &&
    (!c.expiresAt || new Date(c.expiresAt) > new Date())
  );
}

/**
 * Get all active consents for a patient
 */
function getConsents(patientId) {
  const consents = load();
  return consents.filter(c => c.patientId === patientId && c.status === 'active');
}

/**
 * Get all consents (for audit/compliance reporting)
 */
function getAllConsents() {
  return load();
}

module.exports = { recordConsent, revokeConsent, hasConsent, getConsents, getAllConsents };
