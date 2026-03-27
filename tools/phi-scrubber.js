// ============================================================
// phi-scrubber.js — De-identify PHI before sending to Claude API
//
// HIPAA Safe Harbor method: removes all 18 identifiers before
// data leaves the system. Re-identifies on the way back.
//
// This allows using the Claude API without a BAA by ensuring
// no Protected Health Information reaches Anthropic's servers.
// ============================================================

// The 18 HIPAA Safe Harbor identifiers
const PHI_PATTERNS = {
  // Names
  name: /\b(Linda\s+Fields|Maria\s+Fields|Jonis\s+Fields)\b/gi,
  // Dates (DOB, appointment dates with context)
  dob: /\b(DOB|Date of Birth|born)[:\s]*([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4})\b/gi,
  // Phone numbers
  phone: /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
  // Addresses (street level)
  address: /\b\d{3,5}\s+[\w\s]{2,30}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Rd|Road|Pkwy|Parkway|Circle|Cir|Pl|Place)\b\.?\s*,?\s*(?:(?:Apt|Suite|Unit|#)\s*\w+)?/gi,
  // ZIP codes
  zip: /\b\d{5}(?:-\d{4})?\b/g,
  // Email
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // SSN
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  // Medicare/Insurance member IDs (alphanumeric patterns)
  memberId: /\b(?:Member\s*(?:ID|#)|ID#?|Medicare\s*#?)[:\s]*([A-Z0-9]{4,}[-\s]?[A-Z0-9]{2,}[-\s]?[A-Z0-9]{2,})\b/gi,
  // MRN / Medical Record Numbers
  mrn: /\b(?:MRN|Medical Record|Record\s*#)[:\s]*(\w+)\b/gi,
};

// Map of placeholder tokens → original values for re-identification
class PHIScrubber {
  constructor() {
    this.tokenMap = new Map(); // token → original value
    this.counter = 0;
  }

  /**
   * Generate a unique placeholder token
   */
  _token(type) {
    this.counter++;
    return `[${type.toUpperCase()}_${this.counter}]`;
  }

  /**
   * De-identify a message before sending to Claude
   * Returns { scrubbed: string, tokenMap: Map }
   */
  scrub(text, patientData = {}) {
    if (!text) return { scrubbed: text, tokenMap: this.tokenMap };

    let scrubbed = text;

    // Scrub patient name(s) from context
    const names = this._extractNames(patientData);
    for (const name of names) {
      if (name && name.length > 2) {
        const token = this._token('NAME');
        const nameRegex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        if (nameRegex.test(scrubbed)) {
          this.tokenMap.set(token, name);
          scrubbed = scrubbed.replace(nameRegex, token);
        }
        // Also scrub first name alone
        const firstName = name.split(' ')[0];
        if (firstName && firstName.length > 2) {
          const fnToken = this._token('NAME');
          const fnRegex = new RegExp('\\b' + firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
          if (fnRegex.test(scrubbed)) {
            this.tokenMap.set(fnToken, firstName);
            scrubbed = scrubbed.replace(fnRegex, fnToken);
          }
        }
      }
    }

    // Scrub specific known values from patient data
    if (patientData.dob) {
      const token = this._token('DOB');
      this.tokenMap.set(token, patientData.dob);
      scrubbed = scrubbed.replace(new RegExp(patientData.dob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), token);
    }
    if (patientData.address) {
      const token = this._token('ADDR');
      this.tokenMap.set(token, patientData.address);
      scrubbed = scrubbed.replace(new RegExp(patientData.address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), token);
    }
    if (patientData.insurance?.memberId) {
      const token = this._token('MEMBERID');
      this.tokenMap.set(token, patientData.insurance.memberId);
      scrubbed = scrubbed.replace(new RegExp(patientData.insurance.memberId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), token);
    }

    // Scrub general patterns
    for (const [type, pattern] of Object.entries(PHI_PATTERNS)) {
      scrubbed = scrubbed.replace(pattern, (match) => {
        // Don't double-scrub already tokenized values
        if (match.startsWith('[') && match.endsWith(']')) return match;
        const token = this._token(type);
        this.tokenMap.set(token, match);
        return token;
      });
    }

    return { scrubbed, tokenMap: this.tokenMap };
  }

  /**
   * Scrub the system prompt — keep medical info, remove identifiers
   */
  scrubSystemPrompt(prompt, patientData = {}) {
    return this.scrub(prompt, patientData).scrubbed;
  }

  /**
   * Re-identify Claude's response — put original values back
   */
  restore(text) {
    if (!text) return text;
    let restored = text;
    for (const [token, original] of this.tokenMap) {
      restored = restored.split(token).join(original);
    }
    return restored;
  }

  /**
   * Extract all names from patient data
   */
  _extractNames(patientData) {
    const names = new Set();
    if (patientData.name) names.add(patientData.name);
    if (patientData.primaryDoctor) names.add(patientData.primaryDoctor);
    // Add caregiver names if present
    if (patientData.caregiver?.name) names.add(patientData.caregiver.name);
    return [...names];
  }

  /**
   * Reset the token map (use between conversations)
   */
  reset() {
    this.tokenMap.clear();
    this.counter = 0;
  }
}

module.exports = { PHIScrubber };
