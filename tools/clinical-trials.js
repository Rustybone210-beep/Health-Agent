const https = require("https");
const fs = require("fs");
const path = require("path");
const SAVED_TRIALS_FILE = path.join(__dirname, "..", "data", "saved_trials.json");

function searchTrials(params) {
  return new Promise((resolve, reject) => {
    const q = [];
    if (params.condition) q.push("query.cond=" + encodeURIComponent(params.condition));
    if (params.location) q.push("query.locn=" + encodeURIComponent(params.location));
    if (params.status) q.push("filter.overallStatus=" + encodeURIComponent(params.status));
    else q.push("filter.overallStatus=RECRUITING");
    if (params.age) q.push("filter.advanced=AREA[MinimumAge]RANGE[MIN," + params.age + " years] AND AREA[MaximumAge]RANGE[" + params.age + " years,MAX]");
    if (params.gender) q.push("filter.sex=" + encodeURIComponent(params.gender));
    q.push("pageSize=" + (params.limit || 10));
    q.push("format=json");

    const url = "https://clinicaltrials.gov/api/v2/studies?" + q.join("&");

    https.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const studies = (parsed.studies || []).map(s => {
            const proto = s.protocolSection || {};
            const id = proto.identificationModule || {};
            const status = proto.statusModule || {};
            const desc = proto.descriptionModule || {};
            const eligibility = proto.eligibilityModule || {};
            const contacts = proto.contactsLocationsModule || {};
            const locations = (contacts.locations || []).slice(0, 5);
            return {
              nctId: id.nctId || "",
              title: id.officialTitle || id.briefTitle || "",
              briefTitle: id.briefTitle || "",
              status: status.overallStatus || "",
              phase: (proto.designModule?.phases || []).join(", ") || "Not specified",
              summary: (desc.briefSummary || "").substring(0, 500),
              eligibility: {
                criteria: (eligibility.eligibilityCriteria || "").substring(0, 1000),
                gender: eligibility.sex || "All",
                minAge: eligibility.minimumAge || "",
                maxAge: eligibility.maximumAge || "",
                healthyVolunteers: eligibility.healthyVolunteers || "No"
              },
              locations: locations.map(l => ({
                facility: l.facility || "",
                city: l.city || "",
                state: l.state || "",
                country: l.country || "",
                status: l.status || ""
              })),
              url: "https://clinicaltrials.gov/study/" + (id.nctId || ""),
              startDate: status.startDateStruct?.date || "",
              completionDate: status.completionDateStruct?.date || ""
            };
          });
          resolve({ count: parsed.totalCount || studies.length, studies });
        } catch (e) { reject(new Error("Failed to parse trial data: " + e.message)); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function matchTrialsForPatient(patient) {
  const conditions = patient.conditions || [];
  const age = calcAge(patient.dob);
  const location = patient.address || "San Antonio, TX";
  const searches = conditions.map(c => searchTrials({
    condition: c,
    location,
    age,
    limit: 5
  }));
  return Promise.all(searches).then(results => {
    const allTrials = [];
    const seen = new Set();
    results.forEach(r => {
      r.studies.forEach(s => {
        if (!seen.has(s.nctId)) {
          seen.add(s.nctId);
          allTrials.push(s);
        }
      });
    });
    return { totalMatches: allTrials.length, trials: allTrials.slice(0, 20) };
  });
}

function saveTrial(patientId, trial, notes) {
  let saved = [];
  try {
    if (fs.existsSync(SAVED_TRIALS_FILE)) saved = JSON.parse(fs.readFileSync(SAVED_TRIALS_FILE, "utf8"));
  } catch (e) { saved = []; }
  const exists = saved.some(s => s.nctId === trial.nctId && s.patientId === patientId);
  if (exists) return { already: true };
  saved.push({
    patientId,
    nctId: trial.nctId,
    title: trial.briefTitle || trial.title,
    status: trial.status,
    phase: trial.phase,
    url: trial.url,
    notes: notes || "",
    savedAt: new Date().toISOString()
  });
  fs.writeFileSync(SAVED_TRIALS_FILE, JSON.stringify(saved, null, 2));
  return { saved: true };
}

function getSavedTrials(patientId) {
  try {
    if (!fs.existsSync(SAVED_TRIALS_FILE)) return [];
    const all = JSON.parse(fs.readFileSync(SAVED_TRIALS_FILE, "utf8"));
    return all.filter(s => s.patientId === patientId);
  } catch (e) { return []; }
}

function calcAge(dob) {
  if (!dob) return null;
  try {
    let b;
    if (dob.includes("/")) { const p = dob.split("/"); b = new Date(p[2] + "-" + String(p[0]).padStart(2,"0") + "-" + String(p[1]).padStart(2,"0")); }
    else b = new Date(dob);
    if (isNaN(b.getTime())) return null;
    return Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000));
  } catch (e) { return null; }
}

module.exports = { searchTrials, matchTrialsForPatient, saveTrial, getSavedTrials };
