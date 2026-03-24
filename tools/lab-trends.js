const fs = require("fs");
const path = require("path");
const LAB_HISTORY_FILE = path.join(__dirname, "..", "data", "lab_history.json");

function getLabHistory(patientId) {
  try {
    if (!fs.existsSync(LAB_HISTORY_FILE)) return [];
    const all = JSON.parse(fs.readFileSync(LAB_HISTORY_FILE, "utf8"));
    return all.filter(l => l.patientId === patientId).sort((a, b) => new Date(a.date) - new Date(b.date));
  } catch (e) { return []; }
}

function getTestTrend(patientId, testName) {
  const history = getLabHistory(patientId);
  const points = [];
  for (const lab of history) {
    if (!lab.results) continue;
    for (const [key, val] of Object.entries(lab.results)) {
      if (key.toLowerCase().includes(testName.toLowerCase())) {
        const num = parseFloat(String(val).replace(/[<>]/g, ""));
        if (!isNaN(num)) {
          points.push({ date: lab.date, value: num, test: key });
        }
      }
    }
  }
  return points;
}

function getAllTrends(patientId) {
  const history = getLabHistory(patientId);
  const tests = {};
  for (const lab of history) {
    if (!lab.results) continue;
    for (const [key, val] of Object.entries(lab.results)) {
      const num = parseFloat(String(val).replace(/[<>]/g, ""));
      if (isNaN(num)) continue;
      if (!tests[key]) tests[key] = [];
      tests[key].push({ date: lab.date, value: num });
    }
  }
  const trends = {};
  for (const [test, points] of Object.entries(tests)) {
    if (points.length >= 2) {
      const first = points[0].value;
      const last = points[points.length - 1].value;
      const change = last - first;
      const pct = first !== 0 ? Math.round((change / first) * 100) : 0;
      trends[test] = {
        points,
        direction: change > 0 ? "rising" : change < 0 ? "falling" : "stable",
        change,
        percentChange: pct,
        current: last,
        previous: first
      };
    }
  }
  return trends;
}

function getChartData(patientId, testNames) {
  const names = Array.isArray(testNames) ? testNames : [testNames];
  const datasets = [];
  const colors = ["#2dd4bf", "#f87171", "#fbbf24", "#38bdf8", "#a78bfa", "#fb923c"];
  names.forEach((name, i) => {
    const points = getTestTrend(patientId, name);
    if (points.length > 0) {
      datasets.push({
        label: name,
        data: points.map(p => ({ x: p.date, y: p.value })),
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length] + "20",
        tension: 0.3,
        fill: true
      });
    }
  });
  return { datasets };
}

module.exports = { getLabHistory, getTestTrend, getAllTrends, getChartData };
