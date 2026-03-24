const fs = require("fs");
const path = require("path");
const CLAIMS_FILE = path.join(__dirname, "..", "data", "insurance_claims.json");

function loadClaims() {
  try {
    if (!fs.existsSync(CLAIMS_FILE)) return [];
    return JSON.parse(fs.readFileSync(CLAIMS_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveClaims(claims) {
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2));
}

function createClaim({ patientId, type, providerName, serviceDate, diagnosis, procedureCode, chargedAmount, insuranceName, memberId, notes, billImagePath }) {
  const claims = loadClaims();
  const claim = {
    id: Date.now().toString(),
    patientId,
    type: type || "medical",
    providerName: providerName || "",
    serviceDate: serviceDate || "",
    diagnosis: diagnosis || "",
    procedureCode: procedureCode || "",
    chargedAmount: parseFloat(chargedAmount) || 0,
    insuranceName: insuranceName || "",
    memberId: memberId || "",
    notes: notes || "",
    billImagePath: billImagePath || null,
    status: "draft",
    appealStatus: null,
    timeline: [{ date: new Date().toISOString(), action: "Claim created", by: "system" }],
    estimatedReimbursement: null,
    actualReimbursement: null,
    patientResponsibility: null,
    denialReason: null,
    appealDeadline: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  claims.push(claim);
  saveClaims(claims);
  return claim;
}

function updateClaimStatus(claimId, status, details) {
  const claims = loadClaims();
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return null;
  claim.status = status;
  claim.updatedAt = new Date().toISOString();
  claim.timeline.push({
    date: new Date().toISOString(),
    action: "Status changed to " + status,
    details: details || "",
    by: "user"
  });
  if (status === "denied" && details) {
    claim.denialReason = details;
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 180);
    claim.appealDeadline = deadline.toISOString().split("T")[0];
  }
  if (status === "paid") {
    claim.actualReimbursement = parseFloat(details) || 0;
    claim.patientResponsibility = claim.chargedAmount - claim.actualReimbursement;
  }
  saveClaims(claims);
  return claim;
}

function createAppeal(claimId, reason, supportingDocs) {
  const claims = loadClaims();
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return null;
  claim.appealStatus = "filed";
  claim.status = "appeal_pending";
  claim.updatedAt = new Date().toISOString();
  claim.timeline.push({
    date: new Date().toISOString(),
    action: "Appeal filed",
    details: reason,
    by: "user"
  });
  if (!claim.appeal) claim.appeal = {};
  claim.appeal = {
    reason,
    supportingDocs: supportingDocs || [],
    filedAt: new Date().toISOString(),
    letterGenerated: false
  };
  saveClaims(claims);
  return claim;
}

function generateAppealLetter(claim, patient) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let letter = "";
  letter += today + "\n\n";
  letter += (claim.insuranceName || "Insurance Company") + "\n";
  letter += "Claims Department\n\n";
  letter += "RE: Appeal of Claim Denial\n";
  letter += "Patient: " + (patient?.name || "Patient Name") + "\n";
  letter += "Member ID: " + (claim.memberId || "____________") + "\n";
  letter += "Date of Service: " + (claim.serviceDate || "____________") + "\n";
  letter += "Provider: " + (claim.providerName || "____________") + "\n";
  letter += "Claim Amount: $" + (claim.chargedAmount || 0).toFixed(2) + "\n\n";
  letter += "Dear Claims Review Department,\n\n";
  letter += "I am writing to formally appeal the denial of the above-referenced claim. ";
  if (claim.denialReason) {
    letter += "The claim was denied for the following reason: \"" + claim.denialReason + "\"\n\n";
  }
  letter += "I believe this denial should be reconsidered for the following reasons:\n\n";
  if (claim.appeal?.reason) {
    letter += claim.appeal.reason + "\n\n";
  } else {
    letter += "[INSERT SPECIFIC MEDICAL JUSTIFICATION]\n\n";
  }
  letter += "The treatment/service was medically necessary as determined by " + (claim.providerName || "the treating physician") + ". ";
  letter += "I have enclosed supporting documentation including:\n\n";
  letter += "1. Doctor's letter of medical necessity\n";
  letter += "2. Relevant medical records\n";
  letter += "3. Clinical guidelines supporting this treatment\n\n";
  letter += "Under [STATE] insurance regulations and the terms of my policy, I request that you:\n";
  letter += "1. Conduct a full and fair review of this appeal\n";
  letter += "2. Provide a written explanation of the decision\n";
  letter += "3. Process this appeal within the required timeframe\n\n";
  letter += "Please contact me at the address on file if additional information is needed.\n\n";
  letter += "Sincerely,\n\n";
  letter += "________________________________\n";
  letter += (patient?.name || "Patient Name") + "\n";
  letter += "Member ID: " + (claim.memberId || "____________") + "\n";
  return letter;
}

function getClaims(patientId, status) {
  let claims = loadClaims().filter(c => c.patientId === patientId);
  if (status) claims = claims.filter(c => c.status === status);
  return claims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getClaimsSummary(patientId) {
  const claims = loadClaims().filter(c => c.patientId === patientId);
  return {
    total: claims.length,
    pending: claims.filter(c => c.status === "submitted" || c.status === "draft").length,
    approved: claims.filter(c => c.status === "paid" || c.status === "approved").length,
    denied: claims.filter(c => c.status === "denied").length,
    appealed: claims.filter(c => c.status === "appeal_pending").length,
    totalCharged: claims.reduce((sum, c) => sum + (c.chargedAmount || 0), 0),
    totalReimbursed: claims.reduce((sum, c) => sum + (c.actualReimbursement || 0), 0),
    totalOwed: claims.reduce((sum, c) => sum + (c.patientResponsibility || 0), 0)
  };
}

module.exports = { createClaim, updateClaimStatus, createAppeal, generateAppealLetter, getClaims, getClaimsSummary };
