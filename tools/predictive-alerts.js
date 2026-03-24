const fs = require("fs");
const path = require("path");
const ALERTS_FILE = path.join(__dirname, "..", "data", "predictive_alerts.json");

const PATTERNS = {
  weight_gain_thyroid: {
    name: "Weight Gain + Thyroid Change",
    description: "Weight gain coinciding with thyroid medication change may indicate undertreated hypothyroidism",
    action: "Discuss with endocrinologist. Consider reverting thyroid medication dose.",
    severity: "moderate",
    check: (data) => {
      const weightGain = data.symptoms?.some(s => s.symptom?.toLowerCase().includes("weight gain"));
      const thyroidChange = data.medChanges?.some(m => m.medication?.toLowerCase().includes("synthroid") || m.medication?.toLowerCase().includes("levothyroxine") || m.medication?.toLowerCase().includes("liothyronine"));
      return weightGain && thyroidChange;
    }
  },
  cholesterol_serum_tears: {
    name: "High Cholesterol + Serum Tears",
    description: "Elevated cholesterol may contaminate autologous serum tears with inflammatory lipids",
    action: "Discuss with ophthalmologist. Consider reducing serum tear concentration or pausing until cholesterol improves.",
    severity: "moderate",
    check: (data) => {
      const highChol = data.labs?.some(l => {
        const tc = l.results?.["Total Cholesterol"] || l.results?.["total cholesterol"];
        return tc && parseFloat(tc) > 300;
      });
      const serumTears = data.medications?.some(m => m.name?.toLowerCase().includes("serum tear"));
      return highChol && serumTears;
    }
  },
  bp_rising: {
    name: "Blood Pressure Trend Rising",
    description: "Blood pressure readings have been trending upward over recent measurements",
    action: "Monitor more frequently. If trend continues, discuss medication adjustment with doctor.",
    severity: "moderate",
    check: (data) => {
      const bp = (data.vitals?.blood_pressure_systolic || []).slice(-5);
      if (bp.length < 3) return false;
      let rising = 0;
      for (let i = 1; i < bp.length; i++) {
        if (bp[i].value > bp[i-1].value) rising++;
      }
      return rising >= Math.floor(bp.length * 0.7);
    }
  },
  glucose_unstable: {
    name: "Blood Glucose Instability",
    description: "Blood glucose readings show significant variation, suggesting poor glycemic control",
    action: "Review diet, medication timing, and activity patterns. Share readings with doctor.",
    severity: "high",
    check: (data) => {
      const bg = (data.vitals?.blood_glucose || []).slice(-10);
      if (bg.length < 5) return false;
      const values = bg.map(r => r.value);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
      return Math.sqrt(variance) > 40;
    }
  },
  medication_adherence_drop: {
    name: "Medication Adherence Declining",
    description: "Medication adherence has dropped below 80% in the last 14 days",
    action: "Check if patient is experiencing side effects. Consider medication reminder adjustments.",
    severity: "moderate",
    check: (data) => {
      if (!data.adherence) return false;
      return data.adherence.adherenceRate < 80;
    }
  },
  multiple_symptoms_new_med: {
    name: "Multiple New Symptoms After Medication Change",
    description: "Several new symptoms appeared within 30 days of a medication change, suggesting possible adverse reaction",
    action: "Review recent medication changes with prescribing doctor. Consider drug interaction check.",
    severity: "high",
    check: (data) => {
      if (!data.correlations || data.correlations.length < 2) return false;
      const recentCorrelations = data.correlations.filter(c => c.daysAfterChange <= 30);
      return recentCorrelations.length >= 2;
    }
  },
  eye_symptoms_hormone: {
    name: "Eye Symptoms + Hormone Depletion",
    description: "Worsening eye symptoms in postmenopausal patient with very low estradiol may indicate hormone-driven dry eye",
    action: "Discuss topical hormone therapy for eyes with ophthalmologist. Androgens may help meibomian gland function.",
    severity: "moderate",
    check: (data) => {
      const eyeSymptoms = data.symptoms?.some(s =>
        s.symptom?.toLowerCase().includes("eye") || s.symptom?.toLowerCase().includes("burning") || s.symptom?.toLowerCase().includes("dry")
      );
      const lowEstrogen = data.labs?.some(l => {
        const e = l.results?.["Estradiol"] || l.results?.["estradiol"];
        return e && parseFloat(e) <= 5;
      });
      return eyeSymptoms && lowEstrogen;
    }
  },
  vitamin_d_excess: {
    name: "Vitamin D Excess + Kidney Crystals",
    description: "Vitamin D above 100 with calcium oxalate crystals in urine suggests over-supplementation",
    action: "Reduce Vitamin D supplementation. Recheck levels in 8 weeks. Monitor kidney function.",
    severity: "moderate",
    check: (data) => {
      const highD = data.labs?.some(l => {
        const d = l.results?.["Vitamin D"] || l.results?.["Vitamin D 25 Hydroxy"] || l.results?.["vitamin d"];
        return d && parseFloat(d) > 100;
      });
      return highD;
    }
  },
  missed_appointments: {
    name: "Missed or Cancelled Appointments",
    description: "Multiple appointments cancelled recently may indicate mobility issues, transportation problems, or declining health",
    action: "Check if patient needs transportation assistance or telehealth option.",
    severity: "low",
    check: (data) => {
      const cancelled = (data.appointments || []).filter(a => a.status === "cancelled");
      return cancelled.length >= 2;
    }
  }
};

function runPredictiveAnalysis(patientData) {
  const triggered = [];
  for (const [key, pattern] of Object.entries(PATTERNS)) {
    try {
      if (pattern.check(patientData)) {
        triggered.push({
          id: key,
          name: pattern.name,
          description: pattern.description,
          action: pattern.action,
          severity: pattern.severity,
          detectedAt: new Date().toISOString()
        });
      }
    } catch (e) {}
  }
  triggered.sort((a, b) => {
    const sev = { critical: 0, high: 1, moderate: 2, low: 3 };
    return (sev[a.severity] || 3) - (sev[b.severity] || 3);
  });
  return triggered;
}

function saveAlerts(patientId, alerts) {
  let all = [];
  try {
    if (fs.existsSync(ALERTS_FILE)) all = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8"));
  } catch (e) { all = []; }
  const existing = all.filter(a => a.patientId === patientId);
  const newAlerts = alerts.filter(a => !existing.some(e => e.id === a.id && e.dismissed));
  newAlerts.forEach(a => {
    if (!existing.some(e => e.id === a.id)) {
      all.push({ ...a, patientId, dismissed: false, savedAt: new Date().toISOString() });
    }
  });
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(all.slice(-200), null, 2));
  return newAlerts;
}

function getAlerts(patientId) {
  try {
    if (!fs.existsSync(ALERTS_FILE)) return [];
    const all = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8"));
    return all.filter(a => a.patientId === patientId && !a.dismissed);
  } catch (e) { return []; }
}

function dismissAlert(patientId, alertId) {
  try {
    if (!fs.existsSync(ALERTS_FILE)) return false;
    const all = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8"));
    const alert = all.find(a => a.patientId === patientId && a.id === alertId);
    if (alert) {
      alert.dismissed = true;
      alert.dismissedAt = new Date().toISOString();
      fs.writeFileSync(ALERTS_FILE, JSON.stringify(all, null, 2));
      return true;
    }
    return false;
  } catch (e) { return false; }
}

module.exports = { runPredictiveAnalysis, saveAlerts, getAlerts, dismissAlert, PATTERNS };
