const fs = require("fs");
const path = require("path");

/**
 * Build a complete medical summary from all available data
 */
function buildMedicalSummary(patient, options) {
  const opts = options || {};
  const summary = {
    generatedAt: new Date().toISOString(),
    generatedDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    patient: {
      name: patient.name || "Unknown",
      dob: patient.dob || "Unknown",
      age: calcAge(patient.dob),
      address: patient.address || "",
      relationship: patient.relationship || ""
    },
    insurance: {
      primary: patient.insurance?.primary || "",
      secondary: patient.insurance?.secondary || "",
      memberId: patient.insurance?.memberId || ""
    },
    careTeam: {
      primaryDoctor: patient.primaryDoctor || "",
      clinic: patient.clinic || "",
      preferredHospital: patient.preferredHospital || "",
      pharmacy: patient.pharmacy || {}
    },
    conditions: patient.conditions || [],
    allergies: patient.allergies || [],
    medications: (patient.medications || []).map(m => ({
      name: m.name,
      dose: m.dose || "",
      frequency: m.frequency || "",
      prescriber: m.prescriber || "",
      pharmacy: m.pharmacy || "",
      rxNumber: m.rxNumber || ""
    })),
    surgicalHistory: patient.surgicalHistory || [],
    familyHistory: patient.familyHistory || [],
    recentLabs: [],
    recentImaging: [],
    activeSymptoms: [],
    medicationChanges: [],
    openTasks: [],
    treatmentsTried: [],
    unansweredQuestions: []
  };

  // Load lab history
  try {
    const labFile = path.join(__dirname, "..", "data", "lab_history.json");
    if (fs.existsSync(labFile)) {
      const labs = JSON.parse(fs.readFileSync(labFile, "utf8"));
      const patientLabs = labs.filter(l => l.patientId === patient.id);
      summary.recentLabs = patientLabs.slice(-3).map(l => ({
        date: l.date,
        flaggedCount: l.analysis?.flaggedCount || 0,
        urgentFlags: (l.analysis?.urgentFlags || []).map(f => `${f.test}: ${f.value} ${f.unit} (${f.status})`),
        connections: (l.analysis?.connections || []).map(c => c.condition)
      }));
    }
  } catch (e) {}

  // Load symptom log
  try {
    const symptomFile = path.join(__dirname, "..", "data", "symptom_log.json");
    if (fs.existsSync(symptomFile)) {
      const symptoms = JSON.parse(fs.readFileSync(symptomFile, "utf8"));
      const recent = symptoms.filter(s => s.patientId === patient.id).slice(-20);
      const grouped = {};
      recent.forEach(s => {
        if (!grouped[s.symptom]) grouped[s.symptom] = { count: 0, lastSeen: s.date, severity: s.severity };
        grouped[s.symptom].count++;
        grouped[s.symptom].lastSeen = s.date;
      });
      summary.activeSymptoms = Object.entries(grouped).map(([name, data]) => ({
        symptom: name,
        occurrences: data.count,
        lastSeen: data.lastSeen,
        severity: data.severity
      }));
    }
  } catch (e) {}

  // Load medication changes
  try {
    const medFile = path.join(__dirname, "..", "data", "med_changes.json");
    if (fs.existsSync(medFile)) {
      const changes = JSON.parse(fs.readFileSync(medFile, "utf8"));
      summary.medicationChanges = changes
        .filter(c => c.patientId === patient.id)
        .slice(-10)
        .map(c => ({
          date: c.date,
          medication: c.medication,
          change: c.changeType,
          from: c.oldDose,
          to: c.newDose,
          prescriber: c.prescriber,
          reason: c.reason
        }));
    }
  } catch (e) {}

  // Load timeline for imaging
  try {
    const timelineFile = path.join(__dirname, "..", "data", "timeline.json");
    if (fs.existsSync(timelineFile)) {
      const timeline = JSON.parse(fs.readFileSync(timelineFile, "utf8"));
      summary.recentImaging = (timeline.events || [])
        .filter(e => e.patientId === patient.id && (e.type === "imaging" || e.type === "document"))
        .slice(-5)
        .map(e => ({ date: e.date, title: e.title, summary: e.summary }));
    }
  } catch (e) {}

  // Load tasks
  try {
    const tasksFile = path.join(__dirname, "..", "data", "tasks.json");
    if (fs.existsSync(tasksFile)) {
      const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf8"));
      summary.openTasks = (Array.isArray(tasks) ? tasks : [])
        .filter(t => t.patientId === patient.id && t.status !== "done")
        .map(t => ({ title: t.title, priority: t.priority, dueDate: t.dueDate }));
    }
  } catch (e) {}

  return summary;
}

/**
 * Format the summary as plain text for printing or sharing
 */
function formatSummaryAsText(summary) {
  let text = "";
  text += `MEDICAL SUMMARY — ${summary.patient.name}\n`;
  text += `Generated: ${summary.generatedDate}\n`;
  text += `${"=".repeat(60)}\n\n`;

  text += `PATIENT INFORMATION\n`;
  text += `Name: ${summary.patient.name}\n`;
  text += `DOB: ${summary.patient.dob} (Age: ${summary.patient.age || "?"})\n`;
  text += `Address: ${summary.patient.address}\n`;
  text += `Insurance: ${summary.insurance.primary}${summary.insurance.secondary ? " + " + summary.insurance.secondary : ""}\n`;
  text += `Member ID: ${summary.insurance.memberId}\n\n`;

  text += `CARE TEAM\n`;
  text += `Primary: ${summary.careTeam.primaryDoctor} at ${summary.careTeam.clinic}\n`;
  text += `Hospital: ${summary.careTeam.preferredHospital}\n`;
  text += `Pharmacy: ${summary.careTeam.pharmacy.name || ""} ${summary.careTeam.pharmacy.phone || ""}\n\n`;

  text += `CONDITIONS: ${summary.conditions.join(", ") || "None listed"}\n`;
  text += `ALLERGIES: ${summary.allergies.join(", ") || "None listed"}\n\n`;

  text += `CURRENT MEDICATIONS\n`;
  summary.medications.forEach(m => {
    text += `  • ${m.name} ${m.dose} ${m.frequency}\n`;
  });
  text += "\n";

  if (summary.medicationChanges.length > 0) {
    text += `RECENT MEDICATION CHANGES\n`;
    summary.medicationChanges.forEach(c => {
      text += `  ${c.date}: ${c.medication} — ${c.change}`;
      if (c.from && c.to) text += ` (${c.from} → ${c.to})`;
      if (c.prescriber) text += ` by ${c.prescriber}`;
      text += "\n";
    });
    text += "\n";
  }

  if (summary.activeSymptoms.length > 0) {
    text += `ACTIVE SYMPTOMS\n`;
    summary.activeSymptoms.forEach(s => {
      text += `  • ${s.symptom} (${s.severity}, ${s.occurrences}x, last: ${s.lastSeen})\n`;
    });
    text += "\n";
  }

  if (summary.recentLabs.length > 0) {
    text += `RECENT LAB RESULTS\n`;
    summary.recentLabs.forEach(l => {
      text += `  ${l.date}: ${l.flaggedCount} flagged values\n`;
      l.urgentFlags.forEach(f => { text += `    ⚠️ ${f}\n`; });
    });
    text += "\n";
  }

  if (summary.openTasks.length > 0) {
    text += `OPEN TASKS\n`;
    summary.openTasks.forEach(t => {
      text += `  • [${t.priority}] ${t.title}${t.dueDate ? " (due: " + t.dueDate + ")" : ""}\n`;
    });
    text += "\n";
  }

  text += `${"=".repeat(60)}\n`;
  text += `Generated by Health Agent — This is a caregiver reference document.\n`;
  return text;
}

function calcAge(dob) {
  if (!dob) return null;
  try {
    let b;
    if (dob.includes("/")) {
      const p = dob.split("/");
      b = new Date(`${p[2]}-${String(p[0]).padStart(2,"0")}-${String(p[1]).padStart(2,"0")}`);
    } else { b = new Date(dob); }
    if (isNaN(b.getTime())) return null;
    return Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000));
  } catch (e) { return null; }
}

module.exports = { buildMedicalSummary, formatSummaryAsText };
