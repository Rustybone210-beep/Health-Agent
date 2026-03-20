const fs = require("fs");
const path = require("path");
const claimFile = path.join(__dirname, "..", "data", "claims.json");
const insuranceFile = path.join(__dirname, "..", "data", "insurance_profiles.json");
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

// Insurance profiles
function getInsuranceProfiles() {
  if (!fs.existsSync(insuranceFile)) return [];
  return JSON.parse(fs.readFileSync(insuranceFile, "utf-8"));
}
function saveInsuranceProfile(profile) {
  const profiles = getInsuranceProfiles();
  profile.id = Date.now().toString();
  profile.savedDate = new Date().toISOString();
  profiles.push(profile);
  fs.writeFileSync(insuranceFile, JSON.stringify(profiles, null, 2));
  return profile;
}

// Provider search helper
function buildProviderSearchURL(insurance, specialty, location) {
  const searches = [];
  const ins = encodeURIComponent(insurance || '');
  const spec = encodeURIComponent(specialty || '');
  const loc = encodeURIComponent(location || '');
  searches.push({
    name: 'Google Search',
    url: `https://www.google.com/search?q=${spec}+that+accepts+${ins}+near+${loc}`
  });
  searches.push({
    name: 'Zocdoc',
    url: `https://www.zocdoc.com/search?insurance=${ins}&specialty=${spec}&location=${loc}`
  });
  searches.push({
    name: 'Healthgrades',
    url: `https://www.healthgrades.com/find-a-doctor?location=${loc}&specialty=${spec}`
  });
  return searches;
}

module.exports = { getClaims, addClaim, updateClaim, getInsuranceProfiles, saveInsuranceProfile, buildProviderSearchURL };
