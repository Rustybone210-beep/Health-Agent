const fs = require("fs");
const path = require("path");
const LAB_HISTORY_FILE = path.join(__dirname, "..", "data", "lab_history.json");

// Reference ranges for common lab tests
const REFERENCE_RANGES = {
  // Lipid Panel
  "total cholesterol": { low: 0, high: 200, unit: "mg/dL", category: "lipids" },
  "ldl": { low: 0, high: 100, unit: "mg/dL", category: "lipids" },
  "ldl cholesterol": { low: 0, high: 100, unit: "mg/dL", category: "lipids" },
  "hdl": { low: 40, high: 999, unit: "mg/dL", category: "lipids" },
  "hdl cholesterol": { low: 40, high: 999, unit: "mg/dL", category: "lipids" },
  "triglycerides": { low: 0, high: 150, unit: "mg/dL", category: "lipids" },
  "sd-ldl": { low: 0, high: 40, unit: "mg/dL", category: "lipids" },

  // Thyroid
  "tsh": { low: 0.45, high: 4.5, unit: "mIU/L", category: "thyroid" },
  "free t4": { low: 0.82, high: 1.77, unit: "ng/dL", category: "thyroid" },
  "free t3": { low: 2.0, high: 4.4, unit: "pg/mL", category: "thyroid" },
  "t4 free": { low: 0.82, high: 1.77, unit: "ng/dL", category: "thyroid" },
  "t3 free": { low: 2.0, high: 4.4, unit: "pg/mL", category: "thyroid" },

  // Metabolic
  "glucose": { low: 70, high: 100, unit: "mg/dL", category: "metabolic" },
  "glucose fasting": { low: 70, high: 100, unit: "mg/dL", category: "metabolic" },
  "hemoglobin a1c": { low: 4.0, high: 5.7, unit: "%", category: "metabolic" },
  "hba1c": { low: 4.0, high: 5.7, unit: "%", category: "metabolic" },
  "bun": { low: 6, high: 20, unit: "mg/dL", category: "kidney" },
  "creatinine": { low: 0.6, high: 1.2, unit: "mg/dL", category: "kidney" },
  "egfr": { low: 60, high: 999, unit: "mL/min", category: "kidney" },
  "sodium": { low: 136, high: 145, unit: "mEq/L", category: "metabolic" },
  "potassium": { low: 3.5, high: 5.0, unit: "mEq/L", category: "metabolic" },
  "calcium": { low: 8.5, high: 10.5, unit: "mg/dL", category: "metabolic" },
  "carbon dioxide": { low: 23, high: 29, unit: "mEq/L", category: "metabolic" },
  "chloride": { low: 98, high: 106, unit: "mEq/L", category: "metabolic" },

  // Liver
  "alt": { low: 7, high: 56, unit: "U/L", category: "liver" },
  "ast": { low: 10, high: 40, unit: "U/L", category: "liver" },
  "alkaline phosphatase": { low: 44, high: 147, unit: "U/L", category: "liver" },
  "bilirubin total": { low: 0.1, high: 1.2, unit: "mg/dL", category: "liver" },
  "albumin": { low: 3.5, high: 5.5, unit: "g/dL", category: "liver" },
  "total protein": { low: 6.0, high: 8.3, unit: "g/dL", category: "liver" },

  // CBC
  "wbc": { low: 4.5, high: 11.0, unit: "K/uL", category: "blood" },
  "rbc": { low: 3.9, high: 5.5, unit: "M/uL", category: "blood" },
  "hemoglobin": { low: 11.5, high: 15.5, unit: "g/dL", category: "blood" },
  "hematocrit": { low: 34, high: 46, unit: "%", category: "blood" },
  "platelets": { low: 150, high: 400, unit: "K/uL", category: "blood" },

  // Iron
  "iron": { low: 60, high: 170, unit: "mcg/dL", category: "iron" },
  "ferritin": { low: 12, high: 150, unit: "ng/mL", category: "iron" },
  "tibc": { low: 250, high: 400, unit: "mcg/dL", category: "iron" },

  // Vitamins
  "vitamin d": { low: 30, high: 100, unit: "ng/mL", category: "vitamins" },
  "vitamin d 25 hydroxy": { low: 30, high: 100, unit: "ng/mL", category: "vitamins" },
  "vitamin b12": { low: 200, high: 900, unit: "pg/mL", category: "vitamins" },
  "folate": { low: 2.7, high: 17.0, unit: "ng/mL", category: "vitamins" },

  // Hormones
  "estradiol": { low: 0, high: 400, unit: "pg/mL", category: "hormones", note: "Postmenopausal: <5 is expected but may affect dry eye/MGD" },
  "testosterone total": { low: 15, high: 70, unit: "ng/dL", category: "hormones", note: "Female range. Low levels worsen dry eye" },
  "testosterone free": { low: 0.1, high: 6.4, unit: "pg/mL", category: "hormones" },
  "shbg": { low: 18, high: 144, unit: "nmol/L", category: "hormones", note: "High SHBG binds hormones, reducing tissue availability" },
  "dhea sulfate": { low: 15, high: 200, unit: "mcg/dL", category: "hormones" },
  "progesterone": { low: 0, high: 1.0, unit: "ng/mL", category: "hormones" },

  // Inflammation
  "crp": { low: 0, high: 3.0, unit: "mg/L", category: "inflammation" },
  "hs crp": { low: 0, high: 3.0, unit: "mg/L", category: "inflammation" },
  "esr": { low: 0, high: 30, unit: "mm/hr", category: "inflammation" },
  "sed rate": { low: 0, high: 30, unit: "mm/hr", category: "inflammation" }
};

// Connections between lab values and conditions/medications
const LAB_CONNECTIONS = {
  "high_cholesterol": {
    condition: "Elevated cholesterol",
    related_to: ["thyroid function", "meibomian gland dysfunction", "serum tear quality"],
    medications_affected: ["statins", "thyroid medications"],
    note: "High LDL can increase inflammation. If using autologous serum tears, high cholesterol in blood means high cholesterol in the tears going on the eyes."
  },
  "low_tsh": {
    condition: "Suppressed TSH",
    related_to: ["thyroid medication dosing", "weight changes", "dry eye", "cholesterol metabolism"],
    medications_affected: ["levothyroxine", "synthroid", "liothyronine", "cytomel"],
    note: "TSH below range may indicate overmedication OR optimal for some patients. Reducing thyroid meds when patient is symptomatic (weight gain) needs careful evaluation."
  },
  "high_shbg": {
    condition: "Elevated SHBG",
    related_to: ["hormone availability", "dry eye", "meibomian gland function", "thyroid status"],
    medications_affected: ["thyroid medications", "estrogen"],
    note: "High SHBG binds testosterone and estrogen, reducing the free hormone available to tissues including meibomian glands. Thyroid hormone increases SHBG."
  },
  "high_vitamin_d": {
    condition: "Elevated Vitamin D",
    related_to: ["calcium metabolism", "kidney stones", "serum tear composition"],
    medications_affected: ["vitamin d supplements", "calcium supplements"],
    note: "Vitamin D >100 can cause calcium oxalate crystals in urine and may affect serum tear composition."
  },
  "high_b12": {
    condition: "Elevated B12",
    related_to: ["supplementation", "liver function", "serum tear composition"],
    medications_affected: ["b12 supplements", "b12 injections"],
    note: "B12 >2000 without supplementation warrants investigation. If supplementing, reduce dose."
  },
  "low_estradiol_postmenopausal": {
    condition: "Undetectable estradiol (postmenopausal)",
    related_to: ["dry eye", "meibomian gland atrophy", "bone density", "vaginal/urinary health"],
    medications_affected: [],
    note: "Estrogen deficiency is a major driver of MGD and dry eye in postmenopausal women. Topical ocular hormones may help without systemic risk."
  },
  "low_testosterone_female": {
    condition: "Low testosterone (female)",
    related_to: ["meibomian gland function", "dry eye", "energy", "muscle mass"],
    medications_affected: [],
    note: "Androgens are the PRIMARY hormone driving meibomian gland health. Low testosterone worsens MGD."
  },
  "high_tibc": {
    condition: "Elevated TIBC",
    related_to: ["iron deficiency", "fatigue", "inflammation"],
    medications_affected: ["iron supplements"],
    note: "High TIBC indicates the body needs more iron. Can worsen fatigue and inflammation even without frank anemia."
  }
};

/**
 * Analyze lab results and return flagged values with connections
 */
function analyzeLabResults(labData) {
  const results = {
    flags: [],
    connections: [],
    categories: {},
    summary: "",
    urgentFlags: [],
    watchFlags: [],
    normalCount: 0,
    flaggedCount: 0
  };

  if (!labData || typeof labData !== "object") return results;

  for (const [testName, value] of Object.entries(labData)) {
    const normalizedName = testName.toLowerCase().replace(/[_-]/g, " ").trim();
    const numVal = parseFloat(String(value).replace(/[<>]/g, "").trim());
    if (isNaN(numVal)) continue;

    // Find matching reference range
    let ref = null;
    let matchedKey = null;
    for (const [key, range] of Object.entries(REFERENCE_RANGES)) {
      if (normalizedName.includes(key) || key.includes(normalizedName)) {
        ref = range;
        matchedKey = key;
        break;
      }
    }

    if (!ref) continue;

    const category = ref.category || "other";
    if (!results.categories[category]) results.categories[category] = [];

    const flag = {
      test: testName,
      value: numVal,
      unit: ref.unit,
      range: `${ref.low} - ${ref.high}`,
      status: "normal",
      severity: "none",
      note: ref.note || null
    };

    if (numVal < ref.low) {
      flag.status = "low";
      flag.severity = numVal < ref.low * 0.7 ? "critical" : "flagged";
      results.flaggedCount++;
    } else if (numVal > ref.high) {
      flag.status = "high";
      flag.severity = numVal > ref.high * 1.5 ? "critical" : "flagged";
      results.flaggedCount++;
    } else {
      results.normalCount++;
    }

    results.categories[category].push(flag);

    if (flag.severity === "critical") {
      results.urgentFlags.push(flag);
    } else if (flag.severity === "flagged") {
      results.watchFlags.push(flag);
    }

    // Check connections
    if (flag.status === "high" && normalizedName.includes("cholesterol")) {
      results.connections.push(LAB_CONNECTIONS["high_cholesterol"]);
    }
    if (flag.status === "low" && normalizedName.includes("tsh")) {
      results.connections.push(LAB_CONNECTIONS["low_tsh"]);
    }
    if (flag.status === "high" && normalizedName.includes("shbg")) {
      results.connections.push(LAB_CONNECTIONS["high_shbg"]);
    }
    if (flag.status === "high" && normalizedName.includes("vitamin d")) {
      results.connections.push(LAB_CONNECTIONS["high_vitamin_d"]);
    }
    if (flag.status === "high" && normalizedName.includes("b12")) {
      results.connections.push(LAB_CONNECTIONS["high_b12"]);
    }
    if (flag.status === "high" && normalizedName.includes("tibc")) {
      results.connections.push(LAB_CONNECTIONS["high_tibc"]);
    }
    if (numVal < 5 && normalizedName.includes("estradiol")) {
      results.connections.push(LAB_CONNECTIONS["low_estradiol_postmenopausal"]);
    }
    if (numVal < 0.5 && normalizedName.includes("testosterone free")) {
      results.connections.push(LAB_CONNECTIONS["low_testosterone_female"]);
    }
  }

  // Deduplicate connections
  const seen = new Set();
  results.connections = results.connections.filter(c => {
    if (seen.has(c.condition)) return false;
    seen.add(c.condition);
    return true;
  });

  // Build summary
  const total = results.normalCount + results.flaggedCount;
  results.summary = `${total} tests analyzed: ${results.normalCount} normal, ${results.flaggedCount} flagged (${results.urgentFlags.length} critical, ${results.watchFlags.length} watch).`;
  if (results.connections.length > 0) {
    results.summary += ` ${results.connections.length} cross-system connections found.`;
  }

  return results;
}

/**
 * Save lab results to history for trend tracking
 */
function saveLabToHistory(patientId, labDate, labData, analysis) {
  let history = [];
  try {
    if (fs.existsSync(LAB_HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(LAB_HISTORY_FILE, "utf8"));
    }
  } catch (e) { history = []; }

  history.push({
    id: Date.now().toString(),
    patientId,
    date: labDate || new Date().toISOString().split("T")[0],
    results: labData,
    analysis,
    savedAt: new Date().toISOString()
  });

  // Keep last 50 lab entries
  history = history.slice(-50);
  fs.writeFileSync(LAB_HISTORY_FILE, JSON.stringify(history, null, 2));
  return history.length;
}

/**
 * Compare current labs to previous labs and identify trends
 */
function compareLabTrends(patientId) {
  let history = [];
  try {
    if (fs.existsSync(LAB_HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(LAB_HISTORY_FILE, "utf8"));
    }
  } catch (e) { return { trends: [], message: "No lab history available" }; }

  const patientLabs = history.filter(h => h.patientId === patientId);
  if (patientLabs.length < 2) return { trends: [], message: "Need at least 2 lab results to show trends" };

  const latest = patientLabs[patientLabs.length - 1];
  const previous = patientLabs[patientLabs.length - 2];
  const trends = [];

  if (latest.results && previous.results) {
    for (const [test, currentVal] of Object.entries(latest.results)) {
      const prevVal = previous.results[test];
      if (prevVal === undefined) continue;
      const curr = parseFloat(String(currentVal).replace(/[<>]/g, ""));
      const prev = parseFloat(String(prevVal).replace(/[<>]/g, ""));
      if (isNaN(curr) || isNaN(prev)) continue;

      const change = curr - prev;
      const pctChange = prev !== 0 ? Math.round((change / prev) * 100) : 0;

      if (Math.abs(pctChange) >= 5) {
        trends.push({
          test,
          previous: prev,
          current: curr,
          change,
          percentChange: pctChange,
          direction: change > 0 ? "up" : "down",
          previousDate: previous.date,
          currentDate: latest.date
        });
      }
    }
  }

  trends.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));

  return {
    trends,
    message: trends.length > 0
      ? `${trends.length} values changed significantly since ${previous.date}`
      : "No significant changes from previous labs"
  };
}

module.exports = { analyzeLabResults, saveLabToHistory, compareLabTrends, REFERENCE_RANGES, LAB_CONNECTIONS };
