const MEDICAL_DICTIONARY = {
  "hypertension": { plain: "High blood pressure", spanish: "Presión arterial alta" },
  "hypotension": { plain: "Low blood pressure", spanish: "Presión arterial baja" },
  "tachycardia": { plain: "Fast heart rate (over 100 bpm)", spanish: "Ritmo cardíaco rápido" },
  "bradycardia": { plain: "Slow heart rate (under 60 bpm)", spanish: "Ritmo cardíaco lento" },
  "myocardial infarction": { plain: "Heart attack", spanish: "Ataque al corazón" },
  "cerebrovascular accident": { plain: "Stroke", spanish: "Derrame cerebral" },
  "edema": { plain: "Swelling from fluid buildup", spanish: "Hinchazón" },
  "dyspnea": { plain: "Difficulty breathing", spanish: "Dificultad para respirar" },
  "syncope": { plain: "Fainting", spanish: "Desmayo" },
  "vertigo": { plain: "Spinning dizziness", spanish: "Vértigo" },
  "neuropathy": { plain: "Nerve damage causing pain, numbness, or tingling", spanish: "Daño a los nervios" },
  "stenosis": { plain: "Narrowing of a passage in the body", spanish: "Estrechamiento" },
  "anterolisthesis": { plain: "Forward slipping of one vertebra over another", spanish: "Deslizamiento de vértebra" },
  "kyphosis": { plain: "Forward curvature of the upper spine (hunched back)", spanish: "Curvatura de la columna" },
  "osteophyte": { plain: "Bone spur", spanish: "Espolón óseo" },
  "foraminal narrowing": { plain: "Narrowing of the nerve exit holes in the spine", spanish: "Estrechamiento del canal nervioso" },
  "laminectomy": { plain: "Surgery to remove part of the vertebra to relieve pressure on nerves", spanish: "Cirugía para aliviar presión en los nervios" },
  "meibomian gland dysfunction": { plain: "Blocked oil glands in the eyelids causing dry eyes", spanish: "Glándulas de los párpados bloqueadas" },
  "blepharitis": { plain: "Inflammation of the eyelids", spanish: "Inflamación de los párpados" },
  "demodex": { plain: "Microscopic mites living in eyelash follicles", spanish: "Ácaros microscópicos en los párpados" },
  "trichiasis": { plain: "Misdirected eyelashes poking the eye surface", spanish: "Pestañas mal dirigidas" },
  "ocular rosacea": { plain: "Skin condition causing chronic eye redness and inflammation", spanish: "Rosácea ocular" },
  "meibography": { plain: "Imaging test to see the oil glands inside your eyelids", spanish: "Imagen de las glándulas de los párpados" },
  "ipl": { plain: "Intense Pulsed Light — light treatment to improve oil gland function and kill mites", spanish: "Tratamiento con luz pulsada" },
  "lipiflow": { plain: "Thermal treatment to unclog oil glands in the eyelids", spanish: "Tratamiento térmico para destapar glándulas" },
  "hyperlipidemia": { plain: "High cholesterol or fats in the blood", spanish: "Colesterol alto" },
  "hypothyroidism": { plain: "Underactive thyroid — body doesn't make enough thyroid hormone", spanish: "Tiroides poco activa" },
  "levothyroxine": { plain: "Synthetic thyroid hormone (brand: Synthroid)", spanish: "Hormona tiroidea sintética" },
  "liothyronine": { plain: "Active thyroid hormone T3 (brand: Cytomel)", spanish: "Hormona tiroidea activa T3" },
  "tsh": { plain: "Thyroid Stimulating Hormone — tells you if thyroid is working properly", spanish: "Hormona estimulante de tiroides" },
  "shbg": { plain: "Sex Hormone Binding Globulin — protein that binds hormones so they can't reach tissues", spanish: "Proteína que atrapa hormonas" },
  "estradiol": { plain: "Main estrogen hormone — drops to near zero after menopause", spanish: "Hormona estrógeno principal" },
  "egfr": { plain: "Estimated kidney filtering rate — measures how well kidneys clean blood", spanish: "Tasa de filtración de los riñones" },
  "a1c": { plain: "3-month average blood sugar — shows diabetes control", spanish: "Promedio de azúcar en sangre de 3 meses" },
  "hemoglobin a1c": { plain: "3-month average blood sugar level", spanish: "Promedio de azúcar de 3 meses" },
  "creatinine": { plain: "Waste product filtered by kidneys — high levels mean kidney problems", spanish: "Producto de desecho filtrado por los riñones" },
  "bun": { plain: "Blood Urea Nitrogen — another kidney function marker", spanish: "Nitrógeno ureico en sangre" },
  "alt": { plain: "Liver enzyme — high levels can mean liver damage", spanish: "Enzima del hígado" },
  "ast": { plain: "Liver enzyme — elevated in liver or muscle damage", spanish: "Enzima del hígado" },
  "prognosis": { plain: "Expected outcome or course of a disease", spanish: "Pronóstico" },
  "benign": { plain: "Not cancerous, not harmful", spanish: "Benigno — no es cáncer" },
  "malignant": { plain: "Cancerous, can spread", spanish: "Maligno — canceroso" },
  "metastasis": { plain: "Cancer spreading to other parts of the body", spanish: "Cáncer que se propaga" },
  "pulmonary nodule": { plain: "Small spot on the lung found on imaging — usually monitored, often not cancer", spanish: "Punto pequeño en el pulmón" },
  "prior authorization": { plain: "Permission from insurance before they'll pay for a treatment", spanish: "Autorización previa del seguro" },
  "eob": { plain: "Explanation of Benefits — insurance document showing what they paid and what you owe", spanish: "Explicación de beneficios del seguro" },
  "copay": { plain: "Fixed amount you pay at each doctor visit", spanish: "Copago" },
  "deductible": { plain: "Amount you must pay before insurance starts covering costs", spanish: "Deducible" },
  "formulary": { plain: "List of medications your insurance plan covers", spanish: "Lista de medicamentos cubiertos" }
};

function translateTerm(term) {
  const lower = term.toLowerCase().trim();
  if (MEDICAL_DICTIONARY[lower]) return MEDICAL_DICTIONARY[lower];
  for (const [key, value] of Object.entries(MEDICAL_DICTIONARY)) {
    if (lower.includes(key) || key.includes(lower)) return { ...value, matchedTerm: key };
  }
  return null;
}

function translateText(text) {
  if (!text) return { original: text, translations: [], simplified: text };
  const translations = [];
  const words = text.toLowerCase();
  for (const [term, def] of Object.entries(MEDICAL_DICTIONARY)) {
    if (words.includes(term)) {
      translations.push({ term, plain: def.plain, spanish: def.spanish });
    }
  }
  let simplified = text;
  for (const t of translations) {
    const regex = new RegExp(t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    simplified = simplified.replace(regex, t.plain);
  }
  return { original: text, translations, simplified, termCount: translations.length };
}

function getFullDictionary() {
  return Object.entries(MEDICAL_DICTIONARY).map(([term, def]) => ({
    term,
    plain: def.plain,
    spanish: def.spanish
  }));
}

module.exports = { translateTerm, translateText, getFullDictionary, MEDICAL_DICTIONARY };
