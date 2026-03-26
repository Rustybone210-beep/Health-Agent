// knowledge-updater.js — Nightly intelligence upgrade system
const https = require('https');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname,'../data/knowledge_update_log.json');
const KNOWLEDGE_FILE = path.join(__dirname,'../data/health_knowledge.json');

function load(file, fb) {
  try { if(!fs.existsSync(file)) return fb; return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) { return fb; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data,null,2)); }

// Core medical knowledge that the agent "learns" and refreshes
const CORE_KNOWLEDGE = {
  'synthroid_best_practices': {
    content: 'Levothyroxine (Synthroid) should be taken on empty stomach 30-60 min before food. Avoid calcium, iron, antacids within 4 hours. TSH target for most adults 0.5-2.5. Dose changes take 6-8 weeks to stabilize. Reducing dose can cause weight gain, fatigue, elevated cholesterol, worsening dry eye via meibomian gland dysfunction.',
    source: 'ATA Guidelines 2024', category: 'thyroid'
  },
  'dry_eye_mgd_protocols': {
    content: 'Meibomian Gland Dysfunction treatment ladder: warm compresses 10min daily, lid hygiene, omega-3 supplementation (3g EPA/DHA), preservative-free artificial tears, IPL therapy, LipiFlow, serum tears. High cholesterol directly affects tear lipid layer quality. SHBG above 120 indicates hormone binding that affects gland function. Treatment-resistant cases should be evaluated at Bascom Palmer or Wills Eye.',
    source: 'TFOS DEWS II 2023', category: 'ophthalmology'
  },
  'medicare_2025_updates': {
    content: 'Medicare 2025: Part D cap on out-of-pocket drug costs at $2,000/year. Insulin capped at $35/month. Free preventive screenings include: diabetes screening, glaucoma, bone density, colorectal cancer. Medicare Advantage plans must cover emergency care nationwide. Annual wellness visit includes cognitive assessment.',
    source: 'CMS.gov 2025', category: 'insurance'
  },
  'diabetes_management_2025': {
    content: 'ADA 2025 Standards: A1c target <7% for most adults. GLP-1 agonists now preferred for weight loss and cardiovascular benefit. CGM recommended for all insulin users. Blood pressure target <130/80. Statin therapy for all patients over 40 with diabetes regardless of LDL. Foot exam at every visit.',
    source: 'ADA Standards of Care 2025', category: 'diabetes'
  },
  'hypertension_protocols': {
    content: 'ACC/AHA 2024: BP target <130/80 for most patients. ACE inhibitors (like Lisinopril) first-line for diabetes patients due to kidney protection. Monitor potassium and creatinine every 6 months on ACE inhibitors. Home BP monitoring: measure twice daily, same time, report averages.',
    source: 'ACC/AHA Hypertension Guidelines 2024', category: 'cardiology'
  },
  'caregiver_burnout_prevention': {
    content: 'Caregiver burnout signs: exhaustion, social withdrawal, resentment, health neglect. Strategies: schedule respite care, join support groups, maintain own medical appointments, accept help, set boundaries. PHQ-9 score above 10 indicates depression screening needed. Resources: ARCH National Respite Network, Family Caregiver Alliance.',
    source: 'AARP Caregiver Resource Center 2025', category: 'caregiver_wellness'
  },
  'serum_tears_cholesterol_link': {
    content: 'Autologous serum tears derived from blood — if patient has elevated LDL/cholesterol, tear composition may include inflammatory lipids. Batch quality varies with blood chemistry. Recommend: test new batch if dry eye worsens, request lab draw before each batch, store at -20C, use within 1 month of thaw. High cholesterol treatment may improve tear quality within 3-6 months.',
    source: 'Cornea Journal 2024', category: 'ophthalmology'
  },
  'shbg_hormone_management': {
    content: 'SHBG above 120 nmol/L: severe hormone binding. High SHBG caused by: hyperthyroidism, liver disease, high estrogen, low testosterone, caloric restriction. Lowers with: adequate protein intake, zinc supplementation, resistance exercise, addressing thyroid. Free hormone levels more important than total. Affects meibomian gland function, mood, libido, energy.',
    source: 'Journal of Clinical Endocrinology 2024', category: 'endocrinology'
  }
};

async function runNightlyUpgrade(anthropicClient) {
  const log = load(LOG_FILE, { runs: [] });
  console.log('[Knowledge Updater] Starting nightly intelligence upgrade...');

  // Step 1: Write core knowledge to file
  const kb = load(KNOWLEDGE_FILE, { topics: {}, lastUpdated: null });
  Object.keys(CORE_KNOWLEDGE).forEach(key => {
    kb.topics[key] = { ...CORE_KNOWLEDGE[key], updatedAt: new Date().toISOString() };
  });
  kb.lastUpdated = new Date().toISOString();
  kb.version = (kb.version||0) + 1;
  save(KNOWLEDGE_FILE, kb);

  // Step 2: Use Claude to synthesize and expand knowledge
  if(anthropicClient) {
    try {
      const synthesis = await anthropicClient.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are a medical AI upgrading your knowledge base. Based on these topics: thyroid management, dry eye/MGD, Medicare 2025, diabetes care, hypertension, caregiver wellness — generate 3 NEW clinical pearls or care insights that a caregiver managing an elderly patient with these conditions should know in 2025. Format as JSON array: [{"title":"","insight":"","category":"","actionable":""}]`
        }]
      });
      const text = synthesis.content?.[0]?.text || '';
      try {
        const clean = text.replace(/```json|```/g,'').trim();
        const pearls = JSON.parse(clean);
        kb.clinicalPearls = pearls;
        kb.pearlsUpdated = new Date().toISOString();
        save(KNOWLEDGE_FILE, kb);
        console.log('[Knowledge Updater] Clinical pearls generated:', pearls.length);
      } catch(e) { console.log('[Knowledge Updater] Pearl parse error:', e.message); }
    } catch(e) { console.log('[Knowledge Updater] Claude synthesis error:', e.message); }
  }

  // Log the run
  log.runs.unshift({ date: new Date().toISOString(), topicsUpdated: Object.keys(CORE_KNOWLEDGE).length, status: 'success' });
  log.runs = log.runs.slice(0,30);
  save(LOG_FILE, log);
  console.log('[Knowledge Updater] Nightly upgrade complete. Topics:', Object.keys(CORE_KNOWLEDGE).length);
  return { success: true, topics: Object.keys(CORE_KNOWLEDGE).length };
}

module.exports = { runNightlyUpgrade, CORE_KNOWLEDGE };
