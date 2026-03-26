// adaptive-agent.js — The brain that learns, adapts, and pre-thinks
const fs = require('fs');
const path = require('path');

const PROFILE_FILE = path.join(__dirname,'../data/agent_profiles.json');
const INSIGHTS_FILE = path.join(__dirname,'../data/agent_insights.json');
const KNOWLEDGE_FILE = path.join(__dirname,'../data/health_knowledge.json');

function load(file, fallback) {
  try { if(!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) { return fallback; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data,null,2)); }

// ── HABIT TRACKING ──
function trackInteraction(userId, patientId, action, context) {
  const profiles = load(PROFILE_FILE, {});
  if(!profiles[userId]) profiles[userId] = { userId, patientId, habits: [], topActions: {}, timePatterns: {}, lastSeen: null, streak: 0, totalInteractions: 0 };
  const p = profiles[userId];
  const hour = new Date().getHours();
  const timeSlot = hour < 6?'night': hour < 12?'morning': hour < 17?'afternoon':'evening';
  p.habits.unshift({ action, context: context||'', time: new Date().toISOString(), slot: timeSlot });
  p.habits = p.habits.slice(0, 100);
  p.topActions[action] = (p.topActions[action]||0) + 1;
  p.timePatterns[timeSlot] = (p.timePatterns[timeSlot]||0) + 1;
  p.lastSeen = new Date().toISOString();
  p.totalInteractions++;
  const today = new Date().toISOString().split('T')[0];
  if(p.lastActiveDay === today) { /* same day */ }
  else { p.streak = p.lastActiveDay === getPrevDay(today) ? (p.streak||0)+1 : 1; p.lastActiveDay = today; }
  save(PROFILE_FILE, profiles);
  return p;
}

function getPrevDay(dateStr) {
  const d = new Date(dateStr); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0];
}

function getProfile(userId) {
  const profiles = load(PROFILE_FILE, {});
  return profiles[userId] || null;
}

// ── PRE-THINKING ENGINE ──
function generateProactiveInsights(patientId, patient, recentInteractions) {
  const insights = [];
  const p = patient || {};
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const meds = p.medications || [];
  const conditions = (p.conditions||[]).map(c=>c.toLowerCase());

  // Morning med reminder pre-think
  if(hour >= 6 && hour <= 9) {
    const morningMeds = meds.filter(m => {
      const f = (m.frequency||'').toLowerCase();
      return f.includes('daily') || f.includes('morning') || f.includes('once');
    });
    if(morningMeds.length) {
      insights.push({ type:'medication', priority:'high', timing:'morning', title:'Morning Medications Due', message:`${morningMeds.map(m=>m.name).join(', ')} should be taken now. Synthroid requires empty stomach — wait 30 min before eating.`, action:'confirm_meds', icon:'pills' });
    }
  }

  // Synthroid-specific intelligence
  if(meds.some(m=>m.name.toLowerCase().includes('synthroid')||m.name.toLowerCase().includes('levothyroxine'))) {
    insights.push({ type:'health_intelligence', priority:'medium', title:'Thyroid Optimization Tip', message:'Synthroid absorption is blocked by calcium, iron, antacids, and coffee. Take it alone with water on an empty stomach for best results.', icon:'brain' });
  }

  // Weekly lab check reminder
  if(dayOfWeek === 1) {
    if(conditions.some(c=>c.includes('diabetes'))) {
      insights.push({ type:'preventive', priority:'medium', title:'Weekly Diabetes Check', message:'Track blood sugar readings this week. Target: fasting under 130 mg/dL. Note any patterns to share with Dr. Martinez.', icon:'activity' });
    }
  }

  // Dry eye weather intelligence
  insights.push({ type:'environmental', priority:'low', title:'Dry Eye Alert', message:'Indoor heating reduces humidity below 30% — prime conditions for worsening dry eye. Consider a humidifier and increase artificial tear frequency today.', icon:'eye' });

  // Appointment prep pre-think (check if appt in next 3 days)
  insights.push({ type:'proactive', priority:'low', title:'Pre-Think: Next Appointment', message:'Before your next appointment, I can generate a smart prep sheet with questions based on Linda\'s current symptoms, recent med changes, and lab trends.', action:'generate_prep', icon:'calendar' });

  return insights.slice(0,4);
}

// ── KNOWLEDGE BASE ──
function getKnowledge(topic) {
  const kb = load(KNOWLEDGE_FILE, { topics: {}, lastUpdated: null });
  if(!topic) return kb;
  const t = topic.toLowerCase();
  return Object.keys(kb.topics).filter(k => k.toLowerCase().includes(t)).map(k => kb.topics[k]);
}

function updateKnowledge(topic, content, source) {
  const kb = load(KNOWLEDGE_FILE, { topics: {}, lastUpdated: null });
  kb.topics[topic] = { content, source, updatedAt: new Date().toISOString() };
  kb.lastUpdated = new Date().toISOString();
  save(KNOWLEDGE_FILE, kb);
}

function saveInsights(patientId, insights) {
  const data = load(INSIGHTS_FILE, {});
  data[patientId] = { insights, generatedAt: new Date().toISOString() };
  save(INSIGHTS_FILE, data);
}

function getInsights(patientId) {
  const data = load(INSIGHTS_FILE, {});
  return data[patientId] || { insights: [], generatedAt: null };
}

module.exports = { trackInteraction, getProfile, generateProactiveInsights, getKnowledge, updateKnowledge, saveInsights, getInsights };
