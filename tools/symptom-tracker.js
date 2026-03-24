const fs = require("fs");
const path = require("path");
const SYMPTOM_FILE = path.join(__dirname, "..", "data", "symptom_log.json");
const MED_CHANGES_FILE = path.join(__dirname, "..", "data", "med_changes.json");

/**
 * Log a symptom with timestamp
 */
function logSymptom(patientId, symptom, severity, notes) {
  let log = loadLog(SYMPTOM_FILE);
  const entry = {
    id: Date.now().toString(),
    patientId,
    symptom: symptom,
    severity: severity || "moderate",
    notes: notes || "",
    date: new Date().toISOString().split("T")[0],
    timestamp: new Date().toISOString()
  };
  log.push(entry);
  log = log.slice(-500);
  fs.writeFileSync(SYMPTOM_FILE, JSON.stringify(log, null, 2));
  return entry;
}

/**
 * Log a medication change
 */
function logMedChange(patientId, medication, changeType, oldDose, newDose, reason, prescriber) {
  let log = loadLog(MED_CHANGES_FILE);
  const entry = {
    id: Date.now().toString(),
    patientId,
    medication,
    changeType,
    oldDose: oldDose || null,
    newDose: newDose || null,
    reason: reason || "",
    prescriber: prescriber || "",
    date: new Date().toISOString().split("T")[0],
    timestamp: new Date().toISOString()
  };
  log.push(entry);
  log = log.slice(-500);
  fs.writeFileSync(MED_CHANGES_FILE, JSON.stringify(log, null, 2));
  return entry;
}

/**
 * Find correlations between medication changes and symptom changes
 */
function findCorrelations(patientId, windowDays) {
  const window = (windowDays || 30) * 24 * 60 * 60 * 1000;
  const symptoms = loadLog(SYMPTOM_FILE).filter(s => s.patientId === patientId);
  const medChanges = loadLog(MED_CHANGES_FILE).filter(m => m.patientId === patientId);
  const correlations = [];

  for (const med of medChanges) {
    const medTime = new Date(med.timestamp).getTime();
    const relatedSymptoms = symptoms.filter(s => {
      const sTime = new Date(s.timestamp).getTime();
      return sTime >= medTime && sTime <= medTime + window;
    });

    if (relatedSymptoms.length > 0) {
      const symptomGroups = {};
      relatedSymptoms.forEach(s => {
        if (!symptomGroups[s.symptom]) symptomGroups[s.symptom] = [];
        symptomGroups[s.symptom].push(s);
      });

      for (const [symptom, entries] of Object.entries(symptomGroups)) {
        const avgSeverityScore = entries.reduce((sum, e) => {
          const scores = { mild: 1, moderate: 2, severe: 3, critical: 4 };
          return sum + (scores[e.severity] || 2);
        }, 0) / entries.length;

        const firstOccurrence = Math.round(
          (new Date(entries[0].timestamp).getTime() - medTime) / (24 * 60 * 60 * 1000)
        );

        correlations.push({
          medication: med.medication,
          changeType: med.changeType,
          oldDose: med.oldDose,
          newDose: med.newDose,
          changeDate: med.date,
          symptom,
          symptomCount: entries.length,
          avgSeverity: avgSeverityScore,
          daysAfterChange: firstOccurrence,
          summary: `${symptom} (${entries.length}x, avg severity ${avgSeverityScore.toFixed(1)}/4) appeared ${firstOccurrence} days after ${med.medication} was ${med.changeType}`
        });
      }
    }
  }

  correlations.sort((a, b) => b.avgSeverity - a.avgSeverity);
  return correlations;
}

/**
 * Get symptom timeline for a patient
 */
function getSymptomTimeline(patientId, days) {
  const cutoff = Date.now() - (days || 90) * 24 * 60 * 60 * 1000;
  const symptoms = loadLog(SYMPTOM_FILE)
    .filter(s => s.patientId === patientId && new Date(s.timestamp).getTime() >= cutoff);
  const medChanges = loadLog(MED_CHANGES_FILE)
    .filter(m => m.patientId === patientId && new Date(m.timestamp).getTime() >= cutoff);

  const timeline = [
    ...symptoms.map(s => ({ type: "symptom", date: s.date, ...s })),
    ...medChanges.map(m => ({ type: "med_change", date: m.date, ...m }))
  ];

  timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return timeline;
}

/**
 * Generate a correlation report
 */
function generateCorrelationReport(patientId) {
  const correlations = findCorrelations(patientId, 60);
  const timeline = getSymptomTimeline(patientId, 90);
  const symptoms = loadLog(SYMPTOM_FILE).filter(s => s.patientId === patientId);
  const medChanges = loadLog(MED_CHANGES_FILE).filter(m => m.patientId === patientId);

  return {
    patientId,
    generatedAt: new Date().toISOString(),
    totalSymptoms: symptoms.length,
    totalMedChanges: medChanges.length,
    correlations,
    timeline: timeline.slice(-50),
    insights: correlations.length > 0
      ? correlations.slice(0, 5).map(c => c.summary)
      : ["No correlations found yet. Keep logging symptoms and medication changes."]
  };
}

function loadLog(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) { return []; }
}

module.exports = {
  logSymptom,
  logMedChange,
  findCorrelations,
  getSymptomTimeline,
  generateCorrelationReport
};
