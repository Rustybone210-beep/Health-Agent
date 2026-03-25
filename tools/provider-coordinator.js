const fs = require("fs");
const path = require("path");
const COORD_FILE = path.join(__dirname, "..", "data", "provider_coordination.json");

const CROSS_SPECIALTY_CONNECTIONS = {
  "synthroid": {
    medication: "Synthroid (Levothyroxine)",
    affects: ["endocrinology", "ophthalmology", "cardiology", "dermatology"],
    connections: [
      { specialty: "ophthalmology", alert: "Thyroid hormone changes directly affect meibomian gland function, tear production, and dry eye severity. Notify eye doctor of any dose changes." },
      { specialty: "cardiology", alert: "Thyroid dose changes affect heart rate, cholesterol metabolism, and cardiovascular risk. Monitor lipid panel after dose adjustment." },
      { specialty: "endocrinology", alert: "Weight changes, energy level shifts, and metabolic symptoms should be tracked after any dose modification." }
    ]
  },
  "levothyroxine": { medication: "Levothyroxine", affects: ["endocrinology", "ophthalmology", "cardiology"], connections: [
    { specialty: "ophthalmology", alert: "Thyroid changes affect tear film and meibomian glands. Notify eye doctor." },
    { specialty: "cardiology", alert: "Monitor heart rate and cholesterol after dose changes." }
  ]},
  "liothyronine": { medication: "Liothyronine (Cytomel)", affects: ["endocrinology", "ophthalmology", "cardiology"], connections: [
    { specialty: "ophthalmology", alert: "T3 directly affects ocular surface health. Changes may worsen or improve dry eye." },
    { specialty: "cardiology", alert: "T3 has direct cardiac effects. Monitor heart rate." }
  ]},
  "metformin": { medication: "Metformin", affects: ["endocrinology", "gastroenterology", "ophthalmology"], connections: [
    { specialty: "gastroenterology", alert: "GI side effects common. May affect B12 absorption long-term." },
    { specialty: "ophthalmology", alert: "If contrast dye CT is ordered, Metformin must be stopped 48 hours before." }
  ]},
  "lisinopril": { medication: "Lisinopril", affects: ["cardiology", "nephrology"], connections: [
    { specialty: "nephrology", alert: "Monitor kidney function (creatinine, BUN) regularly." },
    { specialty: "any", alert: "ACE inhibitor cough is common. If new cough develops, report to prescriber." }
  ]},
  "statin": { medication: "Statin", affects: ["cardiology", "hepatology", "endocrinology"], connections: [
    { specialty: "hepatology", alert: "Monitor liver enzymes (ALT, AST) periodically." },
    { specialty: "endocrinology", alert: "Statins can slightly increase blood glucose in diabetic patients." }
  ]},
  "serum tears": { medication: "Autologous Serum Tears", affects: ["ophthalmology", "hematology"], connections: [
    { specialty: "ophthalmology", alert: "Serum tear composition reflects blood chemistry. If cholesterol, inflammatory markers, or hormones change significantly, serum tear quality may be affected. Consider remaking batch after major blood chemistry changes." },
    { specialty: "hematology", alert: "Unusual lipid profiles (very high HDL, high sd-LDL) may affect the therapeutic value of autologous serum tears." }
  ]},
  "doxycycline": { medication: "Doxycycline", affects: ["ophthalmology", "dermatology", "gastroenterology"], connections: [
    { specialty: "ophthalmology", alert: "Anti-inflammatory at 40mg, antibiotic at 100mg. For ocular rosacea, 40mg modified-release (Oracea) is preferred long-term." },
    { specialty: "gastroenterology", alert: "Take with food and full glass of water. Stay upright 30 minutes. Can cause esophageal irritation." }
  ]},
  "vitamin d": { medication: "Vitamin D", affects: ["endocrinology", "nephrology"], connections: [
    { specialty: "nephrology", alert: "Vitamin D > 100 ng/mL can cause calcium oxalate crystals in urine and potential kidney stones. Monitor urinalysis." },
    { specialty: "endocrinology", alert: "Excess vitamin D affects calcium metabolism. Recheck levels if dose changes." }
  ]}
};

function loadCoordination() {
  try { if (!fs.existsSync(COORD_FILE)) return []; return JSON.parse(fs.readFileSync(COORD_FILE, "utf8")); } catch(e) { return []; }
}
function saveCoordination(c) { fs.writeFileSync(COORD_FILE, JSON.stringify(c.slice(-500), null, 2)); }

function checkMedChangeAlerts(medication, changeType, patientDoctors) {
  const medLower = (medication || "").toLowerCase();
  const alerts = [];
  for (const [key, data] of Object.entries(CROSS_SPECIALTY_CONNECTIONS)) {
    if (medLower.includes(key)) {
      data.connections.forEach(conn => {
        const doctorMatch = (patientDoctors || []).find(d =>
          (d.specialty || "").toLowerCase().includes(conn.specialty) || conn.specialty === "any"
        );
        alerts.push({
          medication: data.medication,
          changeType,
          affectedSpecialty: conn.specialty,
          alert: conn.alert,
          doctorToNotify: doctorMatch ? doctorMatch.name : "Find " + conn.specialty + " specialist",
          priority: conn.specialty === "any" ? "low" : "high",
          actionRequired: "Inform " + conn.specialty + " about " + medication + " " + changeType
        });
      });
    }
  }
  return alerts;
}

function logCoordinationAlert(patientId, alert) {
  const log = loadCoordination();
  log.push({
    id: Date.now().toString(),
    patientId,
    ...alert,
    status: "pending",
    notified: false,
    createdAt: new Date().toISOString()
  });
  saveCoordination(log);
}

function getActiveAlerts(patientId) {
  return loadCoordination().filter(a => a.patientId === patientId && a.status === "pending");
}

function resolveAlert(alertId) {
  const log = loadCoordination();
  const a = log.find(x => x.id === alertId);
  if (!a) return null;
  a.status = "resolved";
  a.resolvedAt = new Date().toISOString();
  saveCoordination(log);
  return a;
}

function generateCoordinationReport(patientId, medications, doctors) {
  const allAlerts = [];
  (medications || []).forEach(med => {
    const alerts = checkMedChangeAlerts(med.name, "currently taking", doctors);
    alerts.forEach(a => allAlerts.push(a));
  });
  const pending = getActiveAlerts(patientId);
  return {
    currentMedAlerts: allAlerts,
    pendingNotifications: pending,
    totalConnections: allAlerts.length,
    summary: allAlerts.length + " cross-specialty connections found across " + (medications || []).length + " medications. " + pending.length + " pending notifications."
  };
}

module.exports = { checkMedChangeAlerts, logCoordinationAlert, getActiveAlerts, resolveAlert, generateCoordinationReport, CROSS_SPECIALTY_CONNECTIONS };
