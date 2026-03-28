// Pre-loaded autocomplete data for smart onboarding
// Conditions, medications, insurers, cities, pharmacies

const AC_CONDITIONS = [
"Acne","ADHD","Allergies (Seasonal)","Alzheimer's Disease","Anemia","Anxiety","Arthritis","Asthma",
"Atrial Fibrillation","Back Pain","Bipolar Disorder","Blood Clots","Bronchitis","Cancer","Carpal Tunnel",
"Cataracts","Celiac Disease","Chronic Fatigue","Chronic Pain","COPD","Coronary Artery Disease",
"Crohn's Disease","Deep Vein Thrombosis","Dementia","Depression","Diabetes — Type 1","Diabetes — Type 2",
"Diabetic Neuropathy","Diabetic Retinopathy","Dry Eye","Eczema","Edema","Emphysema","Endometriosis",
"Epilepsy","Erectile Dysfunction","Fibromyalgia","GERD (Acid Reflux)","Glaucoma","Gout","Heart Failure",
"Hepatitis","Hernia","High Blood Pressure (Hypertension)","High Cholesterol (Hyperlipidemia)",
"Hypothyroidism","Hyperthyroidism","IBS (Irritable Bowel)","Insomnia","Interstitial Cystitis",
"Iron Deficiency","Kidney Disease","Kidney Stones","Liver Disease","Lupus","Lyme Disease",
"Macular Degeneration","Menopause","Migraines","Multiple Sclerosis","Neuropathy","Obesity","Osteoarthritis",
"Osteoporosis","Overactive Bladder","Parkinson's Disease","Peripheral Artery Disease","Plantar Fasciitis",
"Pneumonia","Polycystic Ovary Syndrome","Prostate Enlargement (BPH)","Psoriasis","PTSD",
"Pulmonary Embolism","Raynaud's Disease","Restless Leg Syndrome","Rheumatoid Arthritis","Rosacea",
"Sciatica","Scoliosis","Seizures","Shingles","Sickle Cell Disease","Sinusitis","Sleep Apnea",
"Spinal Stenosis","Stroke","Thyroid Nodules","Tinnitus","Trigeminal Neuralgia","Ulcerative Colitis",
"Urinary Tract Infection","Varicose Veins","Vertigo"
];

const AC_MEDICATIONS = [
"Abilify 10mg","Acetaminophen 500mg","Adderall 20mg","Advair 250/50","Albuterol Inhaler","Alendronate 70mg",
"Allegra 180mg","Allopurinol 300mg","Alprazolam 0.5mg","Amitriptyline 25mg","Amlodipine 5mg","Amlodipine 10mg",
"Amoxicillin 500mg","Aspirin 81mg","Atenolol 25mg","Atenolol 50mg","Atorvastatin 10mg","Atorvastatin 20mg",
"Atorvastatin 40mg","Atorvastatin 80mg","Azithromycin 250mg","Baclofen 10mg","Benazepril 20mg",
"Bupropion 150mg","Buspirone 10mg","Carvedilol 12.5mg","Carvedilol 25mg","Cephalexin 500mg",
"Cetirizine 10mg","Citalopram 20mg","Clonazepam 0.5mg","Clonidine 0.1mg","Clopidogrel 75mg",
"Cyclobenzaprine 10mg","Cymbalta 30mg","Cymbalta 60mg","Dexamethasone 4mg","Diazepam 5mg",
"Diclofenac 75mg","Digoxin 0.25mg","Diltiazem 120mg","Diltiazem 240mg","Doxycycline 100mg",
"Duloxetine 30mg","Duloxetine 60mg","Eliquis 5mg","Enalapril 10mg","Escitalopram 10mg","Escitalopram 20mg",
"Esomeprazole 40mg","Estradiol 1mg","Famotidine 20mg","Finasteride 5mg","Fluconazole 150mg",
"Fluoxetine 20mg","Fluticasone Nasal Spray","Furosemide 20mg","Furosemide 40mg","Gabapentin 100mg",
"Gabapentin 300mg","Gabapentin 600mg","Glimepiride 2mg","Glipizide 5mg","Hydrochlorothiazide 25mg",
"Hydroxychloroquine 200mg","Ibuprofen 400mg","Ibuprofen 600mg","Ibuprofen 800mg","Insulin Glargine",
"Insulin Lispro","Jardiance 10mg","Jardiance 25mg","Lamotrigine 100mg","Lansoprazole 30mg",
"Latanoprost Eye Drops","Levothyroxine 25mcg","Levothyroxine 50mcg","Levothyroxine 75mcg",
"Levothyroxine 88mcg","Levothyroxine 100mcg","Levothyroxine 112mcg","Levothyroxine 125mcg",
"Lexapro 10mg","Lexapro 20mg","Lisinopril 5mg","Lisinopril 10mg","Lisinopril 20mg","Lisinopril 40mg",
"Loperamide 2mg","Loratadine 10mg","Lorazepam 0.5mg","Losartan 25mg","Losartan 50mg","Losartan 100mg",
"Meloxicam 7.5mg","Meloxicam 15mg","Metformin 500mg","Metformin 1000mg","Methotrexate 2.5mg",
"Methylprednisolone 4mg","Metoprolol 25mg","Metoprolol 50mg","Metoprolol 100mg","Metronidazole 500mg",
"Montelukast 10mg","Naproxen 250mg","Naproxen 500mg","Nifedipine 30mg","Norvasc 5mg","Norvasc 10mg",
"Omeprazole 20mg","Omeprazole 40mg","Ondansetron 4mg","Oxycodone 5mg","Ozempic 0.25mg","Ozempic 0.5mg",
"Ozempic 1mg","Pantoprazole 40mg","Paroxetine 20mg","Plavix 75mg","Potassium Chloride 20mEq",
"Pradaxa 150mg","Pravastatin 40mg","Prednisone 5mg","Prednisone 10mg","Prednisone 20mg",
"Pregabalin 75mg","Pregabalin 150mg","Propranolol 20mg","Quetiapine 25mg","Quetiapine 100mg",
"Ramipril 5mg","Ranitidine 150mg","Restasis Eye Drops","Rosuvastatin 5mg","Rosuvastatin 10mg",
"Rosuvastatin 20mg","Sertraline 50mg","Sertraline 100mg","Sildenafil 50mg","Simvastatin 20mg",
"Simvastatin 40mg","Spironolactone 25mg","Sumatriptan 50mg","Synthroid 25mcg","Synthroid 50mcg",
"Synthroid 75mcg","Synthroid 88mcg","Synthroid 100mcg","Synthroid 112mcg","Synthroid 125mcg",
"Tamsulosin 0.4mg","Topiramate 25mg","Topiramate 50mg","Tramadol 50mg","Trazodone 50mg","Trazodone 100mg",
"Valsartan 80mg","Valsartan 160mg","Venlafaxine 75mg","Venlafaxine 150mg","Viagra 50mg",
"Warfarin 2mg","Warfarin 5mg","Wegovy 0.25mg","Wellbutrin 150mg","Xarelto 20mg",
"Xdemvy Eye Drops","Zoloft 50mg","Zoloft 100mg"
];

const AC_INSURERS = [
"Medicare","Medicare Advantage","Medicare Supplement Plan A","Medicare Supplement Plan B",
"Medicare Supplement Plan C","Medicare Supplement Plan D","Medicare Supplement Plan F",
"Medicare Supplement Plan G","Medicare Supplement Plan K","Medicare Supplement Plan L",
"Medicare Supplement Plan M","Medicare Supplement Plan N","Medicaid",
"Aetna","Aetna Medicare Advantage","Anthem Blue Cross","Anthem Blue Cross Blue Shield",
"Blue Cross Blue Shield","Blue Cross Blue Shield of Texas","Blue Shield of California",
"CareFirst","Centene","Cigna","Cigna Medicare Advantage","Community Health Plan",
"Coventry Health Care","EmblemHealth","Empire Blue Cross","Florida Blue",
"Geisinger","Health Net","Highmark","Humana","Humana Medicare Advantage",
"Independence Blue Cross","Kaiser Permanente","Magellan Health","Medicaid (State Plan)",
"Molina Healthcare","Oscar Health","Oxford Health Plans","Priority Health",
"Regence Blue Cross Blue Shield","SelectHealth","Tufts Health Plan","Tricare","Tricare for Life",
"UnitedHealthcare","UnitedHealthcare Medicare Advantage","VA Health Care","WellCare",
"None — Uninsured","Other"
];

const AC_PHARMACIES = [
"Walgreens","CVS Pharmacy","Walmart Pharmacy","Rite Aid","HEB Pharmacy",
"Costco Pharmacy","Sam's Club Pharmacy","Kroger Pharmacy","Publix Pharmacy",
"Albertsons Pharmacy","Safeway Pharmacy","Target (CVS)","Amazon Pharmacy",
"Express Scripts","OptumRx","Caremark","Pillpack (Amazon)","Alto Pharmacy",
"Capsule Pharmacy","Genoa Healthcare","Hy-Vee Pharmacy","Meijer Pharmacy",
"Winn-Dixie Pharmacy","Fred Meyer Pharmacy","Specialty Pharmacy","Compounding Pharmacy","Other"
];

const AC_CITIES = [
"New York, NY","Los Angeles, CA","Chicago, IL","Houston, TX","Phoenix, AZ","Philadelphia, PA",
"San Antonio, TX","San Diego, CA","Dallas, TX","San Jose, CA","Austin, TX","Jacksonville, FL",
"Fort Worth, TX","Columbus, OH","Indianapolis, IN","Charlotte, NC","San Francisco, CA","Seattle, WA",
"Denver, CO","Nashville, TN","Oklahoma City, OK","El Paso, TX","Boston, MA","Portland, OR",
"Las Vegas, NV","Memphis, TN","Louisville, KY","Baltimore, MD","Milwaukee, WI","Albuquerque, NM",
"Tucson, AZ","Fresno, CA","Sacramento, CA","Mesa, AZ","Kansas City, MO","Atlanta, GA",
"Omaha, NE","Colorado Springs, CO","Raleigh, NC","Long Beach, CA","Virginia Beach, VA","Miami, FL",
"Oakland, CA","Minneapolis, MN","Tampa, FL","Tulsa, OK","Arlington, TX","New Orleans, LA",
"Bakersfield, CA","Wichita, KS","Cleveland, OH","Aurora, CO","Anaheim, CA","Honolulu, HI",
"Henderson, NV","Stockton, CA","Riverside, CA","Lexington, KY","Corpus Christi, TX","Orlando, FL",
"Irvine, CA","Cincinnati, OH","Newark, NJ","Saint Paul, MN","Pittsburgh, PA","Greensboro, NC",
"St. Louis, MO","Lincoln, NE","Plano, TX","Durham, NC","Chandler, AZ","Chula Vista, CA",
"Buffalo, NY","Scottsdale, AZ","Reno, NV","Gilbert, AZ","Glendale, AZ","North Las Vegas, NV",
"Winston-Salem, NC","Chesapeake, VA","Norfolk, VA","Fremont, CA","Garland, TX","Irving, TX",
"Hialeah, FL","Richmond, VA","Boise, ID","Spokane, WA","Baton Rouge, LA","Des Moines, IA",
"Tacoma, WA","Birmingham, AL","San Bernardino, CA","Modesto, CA","Fontana, CA","Rochester, NY",
"Moreno Valley, CA","Fayetteville, NC","Salt Lake City, UT","Huntsville, AL","Yonkers, NY",
"Glendale, CA","McKinney, TX","Little Rock, AR","Amarillo, TX","Akron, OH","Montgomery, AL",
"Augusta, GA","Grand Rapids, MI","Knoxville, TN","Shreveport, LA","Mobile, AL","Chattanooga, TN",
"Fort Lauderdale, FL","Brownsville, TX","Frisco, TX","Laredo, TX","Lubbock, TX","Sioux Falls, SD"
];

// Autocomplete component
function attachAutocomplete(input, data, onSelect, options = {}) {
  const multi = options.multi || false;
  const pillContainer = options.pillContainer || null;
  let dropdown = null;
  let selectedIdx = -1;

  function createDropdown() {
    if (dropdown) dropdown.remove();
    dropdown = document.createElement('div');
    dropdown.className = 'ac-dropdown';
    dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;z-index:50;background:rgba(15,23,42,0.98);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.08);border-radius:12px;max-height:200px;overflow-y:auto;margin-top:4px;box-shadow:0 8px 32px rgba(0,0,0,0.4)';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(dropdown);
    return dropdown;
  }

  function filter(query) {
    if (!query || query.length < 1) { if (dropdown) dropdown.remove(); dropdown = null; return; }
    const q = query.toLowerCase();
    const matches = data.filter(item => item.toLowerCase().includes(q)).slice(0, 7);
    if (!matches.length) { if (dropdown) dropdown.remove(); dropdown = null; return; }

    const dd = createDropdown();
    selectedIdx = -1;
    dd.innerHTML = matches.map((m, i) =>
      `<div class="ac-item" data-idx="${i}" style="padding:10px 14px;cursor:pointer;font-size:14px;color:#f1f5f9;border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.1s">${highlight(m, q)}</div>`
    ).join('');

    dd.querySelectorAll('.ac-item').forEach(item => {
      item.addEventListener('click', () => select(matches[parseInt(item.dataset.idx)]));
      item.addEventListener('mouseenter', () => item.style.background = 'rgba(20,184,166,0.1)');
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    });
  }

  function highlight(text, query) {
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return text;
    return text.substring(0, idx) + '<strong style="color:#2dd4bf">' + text.substring(idx, idx + query.length) + '</strong>' + text.substring(idx + query.length);
  }

  function select(value) {
    if (multi && pillContainer) {
      addPill(value, pillContainer, input);
      input.value = '';
    } else {
      input.value = value;
    }
    if (dropdown) { dropdown.remove(); dropdown = null; }
    if (onSelect) onSelect(value);
  }

  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('blur', () => setTimeout(() => { if (dropdown) { dropdown.remove(); dropdown = null; } }, 200));
  input.addEventListener('keydown', (e) => {
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.ac-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); updateSelected(items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); updateSelected(items); }
    else if (e.key === 'Enter' && selectedIdx >= 0) { e.preventDefault(); items[selectedIdx]?.click(); }
  });

  function updateSelected(items) {
    items.forEach((item, i) => item.style.background = i === selectedIdx ? 'rgba(20,184,166,0.15)' : 'transparent');
  }
}

function addPill(text, container, input) {
  const pill = document.createElement('span');
  pill.className = 'ac-pill';
  pill.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:100px;font-size:12px;font-weight:600;background:rgba(20,184,166,0.1);color:#2dd4bf;border:1px solid rgba(20,184,166,0.15);margin:2px';
  pill.innerHTML = text + '<span style="cursor:pointer;opacity:0.6;font-size:14px" onclick="this.parentElement.remove()">×</span>';
  container.insertBefore(pill, input);
}

function getPillValues(container) {
  return Array.from(container.querySelectorAll('.ac-pill')).map(p => p.textContent.replace('×', '').trim());
}
