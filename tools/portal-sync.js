const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname,'../data/portals.json');

const DEFAULT_PORTALS = [
  { id:'mychart', name:'MyChart / Epic', url:'https://mychart.com', category:'ehr', icon:'hospital', what:'Doctor visit notes, test results, messages to providers, upcoming appointments', loginField:'Email or username', notes:'Most major health systems. Search your hospital name + MyChart.' },
  { id:'medicare', name:'Medicare (MyMedicare.gov)', url:'https://mymedicare.gov', category:'insurance', icon:'shield', what:'Claims history, coverage details, drug plan, appeals status, Medicare Summary Notice', loginField:'Social Security Number + Medicare ID', notes:'Linda\'s Medicare ID: 6VG3-TR1-TK42' },
  { id:'aetna', name:'Aetna Member Portal', url:'https://member.aetna.com', category:'insurance', icon:'shield', what:'Claims, EOB, prior authorization status, network doctors, drug formulary, supplement coverage', loginField:'Email or member ID', notes:'Aetna Supplement Plan G — covers 80% abroad, no network restrictions' },
  { id:'walgreens', name:'Walgreens Pharmacy', url:'https://walgreens.com', category:'pharmacy', icon:'pills', what:'Prescription history, refill requests, ready for pickup notifications, immunization records', loginField:'Email or phone', notes:'Stone Oak location: (210) 403-0002' },
  { id:'quest', name:'Quest Diagnostics', url:'https://myquest.questdiagnostics.com', category:'labs', icon:'flask', what:'Lab results, test history, share results with doctors, download PDF reports', loginField:'Email', notes:'Most common lab used with Medicare' },
  { id:'labcorp', name:'LabCorp Patient Portal', url:'https://patient.labcorp.com', category:'labs', icon:'flask', what:'Lab results, test history, billing, share with providers', loginField:'Email', notes:'Second most common lab network' },
  { id:'goodrx', name:'GoodRx', url:'https://goodrx.com', category:'pharmacy', icon:'tag', what:'Drug price comparison, coupons, pharmacy pricing, drug information', loginField:'Email (optional)', notes:'Check before paying full price. Often cheaper than insurance copay.' },
  { id:'social_security', name:'Social Security (my.ssa.gov)', url:'https://my.ssa.gov', category:'government', icon:'building', what:'Benefits verification, earnings record, replace Medicare card, change direct deposit', loginField:'SSA account', notes:'Required for Medicare enrollment and survivor benefits' }
];

function load() {
  try {
    if(!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ portals: [], customPortals: [], lastUpdated: null }, null,2));
      return { portals: [], customPortals: [], lastUpdated: null };
    }
    return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
  } catch(e) { return { portals: [], customPortals: [], lastUpdated: null }; }
}
function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2)); }

function getPortals(patientId) {
  const data = load();
  const custom = (data.customPortals||[]).filter(p => !patientId || p.patientId === patientId);
  return [...DEFAULT_PORTALS, ...custom];
}

function addCustomPortal(patientId, portal) {
  const data = load();
  const entry = { id: 'custom_'+Date.now(), patientId, ...portal, addedAt: new Date().toISOString() };
  data.customPortals = data.customPortals || [];
  data.customPortals.push(entry);
  data.lastUpdated = new Date().toISOString();
  save(data);
  return entry;
}

function updatePortalStatus(portalId, patientId, status, lastChecked) {
  const data = load();
  data.statuses = data.statuses || {};
  const key = `${patientId}_${portalId}`;
  data.statuses[key] = { status, lastChecked: lastChecked||new Date().toISOString() };
  save(data);
}

function findPortalForQuery(query) {
  const q = query.toLowerCase();
  return DEFAULT_PORTALS.filter(p =>
    p.what.toLowerCase().includes(q) ||
    p.name.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q)
  ).slice(0,3);
}

module.exports = { getPortals, addCustomPortal, updatePortalStatus, findPortalForQuery, DEFAULT_PORTALS };
