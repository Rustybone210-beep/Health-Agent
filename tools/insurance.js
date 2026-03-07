const fs = require("fs");
const path = require("path");

const claimFile = path.join(__dirname, "..", "data", "claims.json");
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

function getClaims() {
  if (!fs.existsSync(claimFile)) return [];
  return JSON.parse(fs.readFileSync(claimFile, "utf-8"));
}

function addClaim(claim) {
  const claims = getClaims();
  claim.id = Date.now().toString();
  claim.createdDate = new Date().toISOString();
  claim.status = claim.status || "pending";
  claims.push(claim);
  fs.writeFileSync(claimFile, JSON.stringify(claims, null, 2));
  return claim;
}

function updateClaim(id, updates) {
  const claims = getClaims();
  const idx = claims.findIndex(c => c.id === id);
  if (idx >= 0) { Object.assign(claims[idx], updates); fs.writeFileSync(claimFile, JSON.stringify(claims, null, 2)); return claims[idx]; }
  return null;
}

module.exports = { getClaims, addClaim, updateClaim };
