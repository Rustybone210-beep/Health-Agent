const fs = require('fs');
const path = require('path');

const REFERENCE_RANGES = {
  'TSH':{ low:0.4, high:4.0, unit:'mIU/L' },
  'Free T4':{ low:0.8, high:1.8, unit:'ng/dL' },
  'Free T3':{ low:2.3, high:4.2, unit:'pg/mL' },
  'LDL':{ low:0, high:100, unit:'mg/dL' },
  'HDL':{ low:40, high:999, unit:'mg/dL' },
  'Total Cholesterol':{ low:0, high:200, unit:'mg/dL' },
  'Triglycerides':{ low:0, high:150, unit:'mg/dL' },
  'HbA1c':{ low:0, high:5.7, unit:'%' },
  'Glucose':{ low:70, high:100, unit:'mg/dL' },
  'SHBG':{ low:16, high:120, unit:'nmol/L' },
  'Estradiol':{ low:10, high:350, unit:'pg/mL' },
  'Vitamin D':{ low:30, high:100, unit:'ng/mL' },
  'Creatinine':{ low:0.5, high:1.1, unit:'mg/dL' },
  'eGFR':{ low:60, high:999, unit:'mL/min' },
  'ALT':{ low:0, high:40, unit:'U/L' },
  'AST':{ low:0, high:40, unit:'U/L' }
};

function flagValue(name, value) {
  const ref = REFERENCE_RANGES[name];
  if(!ref) return 'normal';
  const v = parseFloat(value);
  if(isNaN(v)) return 'normal';
  if(v < ref.low) return 'low';
  if(v > ref.high) return 'high';
  return 'normal';
}

function getLabHistory(patientId) {
  try {
    const fp = path.join(__dirname,'../data/lab_history.json');
    if(!fs.existsSync(fp)) return [];
    const data = JSON.parse(fs.readFileSync(fp,'utf8'));
    return (Array.isArray(data)?data:[]).filter(l => l.patientId === patientId);
  } catch(e) { return []; }
}

function buildDashboard(patientId) {
  const history = getLabHistory(patientId);
  if(!history.length) return { hasData:false, tests:[], history:[] };
  const testNames = new Set();
  history.forEach(e => Object.keys(e.labs||e.labData||{}).forEach(k => testNames.add(k)));
  const trends = {};
  testNames.forEach(test => {
    const points = history
      .filter(e => (e.labs||e.labData||{})[test] !== undefined)
      .map(e => ({ date: e.date||e.labDate||e.timestamp, value: parseFloat((e.labs||e.labData||{})[test]), flag: flagValue(test,(e.labs||e.labData||{})[test]) }))
      .filter(p => !isNaN(p.value))
      .sort((a,b) => new Date(a.date)-new Date(b.date));
    if(points.length) {
      const latest = points[points.length-1];
      const prev = points.length > 1 ? points[points.length-2] : null;
      trends[test] = { name:test, unit:REFERENCE_RANGES[test]?.unit||'', latest:latest.value, latestDate:latest.date, flag:latest.flag, trend: prev?(latest.value>prev.value?'up':latest.value<prev.value?'down':'stable'):'stable', change: prev?(latest.value-prev.value).toFixed(2):null, points, ref:REFERENCE_RANGES[test]||null };
    }
  });
  const priority = ['TSH','Free T4','LDL','HbA1c','SHBG','Vitamin D','Glucose','Creatinine'];
  const sorted = [...priority.filter(t=>trends[t]),...Object.keys(trends).filter(t=>!priority.includes(t))];
  return { hasData:true, patientId, lastUpdated:new Date().toISOString(), tests:sorted.map(t=>trends[t]), abnormal:sorted.filter(t=>trends[t].flag!=='normal').map(t=>trends[t]) };
}

function generateInsights(dashboard, patient) {
  const insights = [];
  const tests = dashboard.tests || [];
  const get = name => tests.find(t => t.name === name);
  const tsh=get('TSH'), ldl=get('LDL'), shbg=get('SHBG'), hba1c=get('HbA1c'), vitD=get('Vitamin D');
  if(tsh && tsh.flag!=='normal') insights.push({ severity:'high', icon:'thyroid', title:'Thyroid Alert', text:`TSH is ${tsh.latest} ${tsh.unit} (${tsh.flag}). ${tsh.flag.includes('low')?'Low TSH may indicate over-treatment.':'High TSH may indicate under-treatment - can cause weight gain and worsen dry eye.'}` });
  if(ldl && ldl.latest>100) insights.push({ severity:ldl.latest>160?'high':'medium', icon:'cholesterol', title:'Elevated LDL', text:`LDL is ${ldl.latest} mg/dL. High cholesterol affects serum tear quality and may worsen dry eye symptoms.` });
  if(shbg && shbg.latest>120) insights.push({ severity:'high', icon:'hormone', title:'SHBG Critical', text:`SHBG is ${shbg.latest} nmol/L - significantly elevated. High SHBG binds hormones and directly impacts meibomian gland function.` });
  if(hba1c && hba1c.latest>7.0) insights.push({ severity:'high', icon:'glucose', title:'A1c Above Target', text:`HbA1c is ${hba1c.latest}% - above the 7.0% diabetic target.` });
  if(vitD && vitD.latest<30) insights.push({ severity:'medium', icon:'vitamin', title:'Low Vitamin D', text:`Vitamin D is ${vitD.latest} ng/mL - below optimal range (30+).` });
  return insights;
}

module.exports = { buildDashboard, generateInsights, flagValue, REFERENCE_RANGES };
