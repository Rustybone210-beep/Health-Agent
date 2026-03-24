const fs = require("fs");
const path = require("path");
const HEALTH_DATA_FILE = path.join(__dirname, "..", "data", "health_data.json");

const SUPPORTED_METRICS = {
  blood_pressure_systolic: { unit: "mmHg", category: "vitals", label: "Blood Pressure (Systolic)" },
  blood_pressure_diastolic: { unit: "mmHg", category: "vitals", label: "Blood Pressure (Diastolic)" },
  heart_rate: { unit: "bpm", category: "vitals", label: "Heart Rate" },
  blood_glucose: { unit: "mg/dL", category: "vitals", label: "Blood Glucose" },
  weight: { unit: "lbs", category: "body", label: "Weight" },
  steps: { unit: "steps", category: "activity", label: "Steps" },
  oxygen_saturation: { unit: "%", category: "vitals", label: "SpO2" },
  temperature: { unit: "°F", category: "vitals", label: "Temperature" },
  sleep_hours: { unit: "hours", category: "sleep", label: "Sleep" },
  respiratory_rate: { unit: "breaths/min", category: "vitals", label: "Respiratory Rate" }
};

function loadHealthData() {
  try {
    if (!fs.existsSync(HEALTH_DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(HEALTH_DATA_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveHealthData(data) {
  fs.writeFileSync(HEALTH_DATA_FILE, JSON.stringify(data.slice(-5000), null, 2));
}

function recordReading(patientId, metric, value, source, timestamp) {
  const data = loadHealthData();
  const entry = {
    id: Date.now().toString(),
    patientId,
    metric,
    value: parseFloat(value),
    unit: SUPPORTED_METRICS[metric]?.unit || "",
    source: source || "manual",
    timestamp: timestamp || new Date().toISOString(),
    date: (timestamp || new Date().toISOString()).split("T")[0]
  };
  data.push(entry);
  saveHealthData(data);
  return entry;
}

function bulkImport(patientId, readings, source) {
  const data = loadHealthData();
  const imported = [];
  for (const r of readings) {
    if (!r.metric || r.value === undefined) continue;
    const entry = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      patientId,
      metric: r.metric,
      value: parseFloat(r.value),
      unit: SUPPORTED_METRICS[r.metric]?.unit || r.unit || "",
      source: source || r.source || "import",
      timestamp: r.timestamp || new Date().toISOString(),
      date: (r.timestamp || new Date().toISOString()).split("T")[0]
    };
    data.push(entry);
    imported.push(entry);
  }
  saveHealthData(data);
  return imported;
}

function getReadings(patientId, metric, days) {
  const cutoff = Date.now() - (days || 30) * 24 * 60 * 60 * 1000;
  return loadHealthData()
    .filter(d => d.patientId === patientId && d.metric === metric && new Date(d.timestamp).getTime() >= cutoff)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function getLatestVitals(patientId) {
  const data = loadHealthData().filter(d => d.patientId === patientId);
  const latest = {};
  for (const entry of data) {
    if (!latest[entry.metric] || new Date(entry.timestamp) > new Date(latest[entry.metric].timestamp)) {
      latest[entry.metric] = entry;
    }
  }
  return latest;
}

function getVitalsChartData(patientId, metric, days) {
  const readings = getReadings(patientId, metric, days);
  const info = SUPPORTED_METRICS[metric] || {};
  return {
    label: info.label || metric,
    unit: info.unit || "",
    data: readings.map(r => ({ x: r.date, y: r.value }))
  };
}

function checkAlerts(patientId) {
  const latest = getLatestVitals(patientId);
  const alerts = [];
  const v = latest;
  if (v.blood_pressure_systolic && v.blood_pressure_systolic.value > 180) {
    alerts.push({ metric: "blood_pressure_systolic", value: v.blood_pressure_systolic.value, severity: "critical", message: "Systolic BP is critically high at " + v.blood_pressure_systolic.value + " mmHg. Seek immediate medical attention." });
  } else if (v.blood_pressure_systolic && v.blood_pressure_systolic.value > 140) {
    alerts.push({ metric: "blood_pressure_systolic", value: v.blood_pressure_systolic.value, severity: "warning", message: "Systolic BP is elevated at " + v.blood_pressure_systolic.value + " mmHg." });
  }
  if (v.blood_glucose && v.blood_glucose.value > 300) {
    alerts.push({ metric: "blood_glucose", value: v.blood_glucose.value, severity: "critical", message: "Blood glucose is critically high at " + v.blood_glucose.value + " mg/dL. Contact doctor immediately." });
  } else if (v.blood_glucose && v.blood_glucose.value < 70) {
    alerts.push({ metric: "blood_glucose", value: v.blood_glucose.value, severity: "critical", message: "Blood glucose is dangerously low at " + v.blood_glucose.value + " mg/dL. Give 15g fast sugar immediately." });
  }
  if (v.heart_rate && (v.heart_rate.value > 120 || v.heart_rate.value < 50)) {
    alerts.push({ metric: "heart_rate", value: v.heart_rate.value, severity: "warning", message: "Heart rate is " + v.heart_rate.value + " bpm which is outside normal range." });
  }
  if (v.oxygen_saturation && v.oxygen_saturation.value < 92) {
    alerts.push({ metric: "oxygen_saturation", value: v.oxygen_saturation.value, severity: "critical", message: "Oxygen saturation is " + v.oxygen_saturation.value + "%. Below 92% requires medical evaluation." });
  }
  if (v.temperature && v.temperature.value > 101.3) {
    alerts.push({ metric: "temperature", value: v.temperature.value, severity: "warning", message: "Temperature is " + v.temperature.value + "°F. Fever detected." });
  }
  return alerts;
}

module.exports = { recordReading, bulkImport, getReadings, getLatestVitals, getVitalsChartData, checkAlerts, SUPPORTED_METRICS };
