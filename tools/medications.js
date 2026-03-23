const fs = require("fs");
const path = require("path");
const medFile = path.join(__dirname, "..", "data", "medications.json");
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

function getMedications() {
  if (!fs.existsSync(medFile)) return [];
  return JSON.parse(fs.readFileSync(medFile, "utf-8"));
}
function addMedication(med) {
  const meds = getMedications();
  med.addedDate = new Date().toISOString();
  med.id = Date.now().toString();
  if (med.refillDate) med.refillDate = med.refillDate;
  if (med.pharmacy) med.pharmacy = med.pharmacy;
  if (med.prescriber) med.prescriber = med.prescriber;
  if (med.rxNumber) med.rxNumber = med.rxNumber;
  meds.push(med);
  fs.writeFileSync(medFile, JSON.stringify(meds, null, 2));
  return med;
}
function updateMedication(id, updates) {
  const meds = getMedications();
  const idx = meds.findIndex(m => m.id === id);
  if (idx >= 0) {
    Object.assign(meds[idx], updates, { updatedDate: new Date().toISOString() });
    fs.writeFileSync(medFile, JSON.stringify(meds, null, 2));
    return meds[idx];
  }
  return null;
}
function removeMedication(id) {
  let meds = getMedications();
  meds = meds.filter(m => m.id !== id);
  fs.writeFileSync(medFile, JSON.stringify(meds, null, 2));
  return meds;
}
function getMedsNeedingRefill(daysAhead) {
  const meds = getMedications();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + (daysAhead || 7));
  return meds.filter(m => {
    if (!m.refillDate) return false;
    return new Date(m.refillDate) <= cutoff;
  });
}

// ─── Medication Interaction Checker ───────────────────────
// Common drug-drug interactions database
// Each entry: [drugA, drugB, severity, description]
const INTERACTIONS = [
  // ACE Inhibitors
  ['lisinopril', 'potassium', 'high', 'ACE inhibitors increase potassium levels. Combined with potassium supplements, this can cause dangerously high potassium (hyperkalemia).'],
  ['lisinopril', 'spironolactone', 'high', 'Both raise potassium levels. Combined use increases risk of hyperkalemia.'],
  ['lisinopril', 'ibuprofen', 'moderate', 'NSAIDs can reduce the blood pressure-lowering effect of ACE inhibitors and increase kidney damage risk.'],
  ['lisinopril', 'naproxen', 'moderate', 'NSAIDs can reduce effectiveness of ACE inhibitors and increase kidney risk.'],
  ['lisinopril', 'aliskiren', 'high', 'Dual renin-angiotensin system blockade increases risk of kidney failure and hyperkalemia.'],

  // Metformin
  ['metformin', 'alcohol', 'high', 'Alcohol with metformin increases the risk of lactic acidosis, a potentially fatal condition.'],
  ['metformin', 'contrast dye', 'high', 'IV contrast dye with metformin can cause lactic acidosis. Stop metformin 48 hours before and after contrast procedures.'],
  ['metformin', 'furosemide', 'moderate', 'Furosemide may increase metformin blood levels.'],
  ['metformin', 'cimetidine', 'moderate', 'Cimetidine can increase metformin levels by reducing kidney clearance.'],

  // Blood thinners
  ['warfarin', 'aspirin', 'high', 'Both thin the blood through different mechanisms. Combined use significantly increases bleeding risk.'],
  ['warfarin', 'ibuprofen', 'high', 'NSAIDs increase bleeding risk with warfarin and can cause stomach bleeding.'],
  ['warfarin', 'acetaminophen', 'moderate', 'Regular acetaminophen use can increase warfarin effect and INR levels.'],
  ['warfarin', 'vitamin k', 'moderate', 'Vitamin K directly counteracts warfarin. Inconsistent intake can cause dangerous fluctuations.'],
  ['warfarin', 'fish oil', 'moderate', 'Fish oil has mild blood-thinning effects that may add to warfarin effect.'],
  ['eliquis', 'aspirin', 'high', 'Combined use significantly increases bleeding risk.'],
  ['eliquis', 'ibuprofen', 'high', 'NSAIDs with Eliquis significantly increase bleeding risk.'],
  ['xarelto', 'aspirin', 'high', 'Combined use significantly increases bleeding risk.'],
  ['xarelto', 'ibuprofen', 'high', 'NSAIDs with Xarelto significantly increase bleeding risk.'],

  // Statins
  ['atorvastatin', 'grapefruit', 'moderate', 'Grapefruit inhibits metabolism of atorvastatin, increasing drug levels and risk of muscle damage (rhabdomyolysis).'],
  ['simvastatin', 'grapefruit', 'high', 'Grapefruit dramatically increases simvastatin levels. Can cause severe muscle damage.'],
  ['simvastatin', 'amiodarone', 'high', 'Amiodarone increases simvastatin levels, increasing rhabdomyolysis risk. Max simvastatin dose is 20mg with amiodarone.'],
  ['atorvastatin', 'clarithromycin', 'high', 'Clarithromycin significantly increases statin levels and rhabdomyolysis risk.'],
  ['lovastatin', 'grapefruit', 'high', 'Grapefruit dramatically increases lovastatin levels.'],

  // SSRIs/SNRIs
  ['sertraline', 'tramadol', 'high', 'Combined use increases risk of serotonin syndrome (agitation, confusion, rapid heart rate, high blood pressure).'],
  ['fluoxetine', 'tramadol', 'high', 'Combined serotonergic drugs increase risk of serotonin syndrome.'],
  ['escitalopram', 'tramadol', 'high', 'Risk of serotonin syndrome with combined serotonergic drugs.'],
  ['sertraline', 'st johns wort', 'high', 'St. John\'s Wort with SSRIs causes dangerous serotonin syndrome risk.'],
  ['fluoxetine', 'st johns wort', 'high', 'St. John\'s Wort with SSRIs causes serotonin syndrome risk.'],
  ['sertraline', 'warfarin', 'moderate', 'SSRIs can increase bleeding risk and warfarin effectiveness.'],
  ['fluoxetine', 'warfarin', 'moderate', 'SSRIs can increase bleeding risk and warfarin effectiveness.'],

  // Lamotrigine (relevant to Linda Fields)
  ['lamotrigine', 'valproic acid', 'high', 'Valproic acid doubles lamotrigine levels, requiring dose reduction to avoid serious skin reactions (Stevens-Johnson syndrome).'],
  ['lamotrigine', 'carbamazepine', 'moderate', 'Carbamazepine reduces lamotrigine levels significantly. May need dose increase.'],
  ['lamotrigine', 'oral contraceptives', 'moderate', 'Estrogen-containing birth control reduces lamotrigine levels by up to 50%.'],
  ['lamotrigine', 'sertraline', 'low', 'Sertraline may slightly increase lamotrigine levels. Monitor for side effects.'],

  // Diabetes combinations
  ['glipizide', 'metformin', 'low', 'Common combination but increases hypoglycemia risk. Monitor blood sugar closely.'],
  ['insulin', 'metformin', 'moderate', 'Combined use increases hypoglycemia risk. Blood sugar monitoring essential.'],
  ['glipizide', 'fluconazole', 'high', 'Fluconazole increases glipizide levels, causing severe hypoglycemia risk.'],

  // Common OTC interactions
  ['acetaminophen', 'alcohol', 'high', 'Acetaminophen (Tylenol) with alcohol increases risk of severe liver damage.'],
  ['ibuprofen', 'aspirin', 'moderate', 'Ibuprofen can block aspirin\'s cardioprotective effect. Take aspirin 30+ minutes before ibuprofen.'],
  ['omeprazole', 'clopidogrel', 'high', 'Omeprazole significantly reduces clopidogrel effectiveness, increasing clot risk.'],
  ['omeprazole', 'methotrexate', 'moderate', 'Omeprazole can increase methotrexate levels.'],

  // Blood pressure combos
  ['amlodipine', 'simvastatin', 'moderate', 'Amlodipine increases simvastatin levels. Max simvastatin dose should be 20mg.'],
  ['lisinopril', 'losartan', 'high', 'Do not combine ACE inhibitor with ARB — dual blockade increases kidney failure and hyperkalemia risk.'],
  ['atenolol', 'verapamil', 'high', 'Both slow heart rate. Combined use can cause severe bradycardia or heart block.'],
  ['metoprolol', 'verapamil', 'high', 'Both slow heart rate. Combined use can cause severe bradycardia.'],

  // Vitamin D (relevant to Linda Fields)
  ['vitamin d', 'thiazide', 'moderate', 'Thiazide diuretics with vitamin D can cause dangerously high calcium levels.'],
  ['vitamin d', 'calcitriol', 'high', 'Taking both forms of vitamin D together can cause hypercalcemia.'],
];

function checkInteractions(medNames) {
  if (!Array.isArray(medNames) || medNames.length < 2) return [];

  const normalized = medNames.map(n =>
    String(n).toLowerCase().trim()
      .replace(/\d+\s*(mg|mcg|iu|ml)\b/gi, '')  // strip dosages
      .replace(/\s*(daily|twice daily|bid|tid|qid|prn|weekly|monthly)\s*/gi, '') // strip frequency
      .trim()
  ).filter(Boolean);

  const found = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      for (const [drugA, drugB, severity, description] of INTERACTIONS) {
        if ((a.includes(drugA) && b.includes(drugB)) ||
            (a.includes(drugB) && b.includes(drugA))) {
          found.push({
            drug1: medNames[i],
            drug2: medNames[j],
            severity,
            description
          });
        }
      }
    }
  }
  return found;
}

module.exports = { getMedications, addMedication, updateMedication, removeMedication, getMedsNeedingRefill, checkInteractions };
