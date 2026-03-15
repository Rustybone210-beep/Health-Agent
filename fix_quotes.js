// Run this from ~/HealthAgent: node fix_quotes.js
const fs = require('fs');
let f = fs.readFileSync('public/index.html', 'utf8');

// Fix 1: renderTasks - pending span with broken quotes
f = f.replace(
  /\$\{t\.status==="pending"\?"<span class="task-priority" style="background:rgba\(136,146,164,0\.12\);color:var\(--text3\)">pending<\/span>":""\}/g,
  '${t.status==="pending"?`<span class="task-priority" style="background:rgba(136,146,164,0.12);color:var(--text3)">pending</span>`:""}'
);

// Fix 2: renderTasks - in-progress span with broken quotes  
f = f.replace(
  /\$\{t\.status==="in-progress"\?"<span class="task-priority" style="background:var\(--teal-ghost\);color:var\(--teal\)">in progress<\/span>":""\}/g,
  '${t.status==="in-progress"?`<span class="task-priority" style="background:var(--teal-ghost);color:var(--teal)">in progress</span>`:""}'
);

fs.writeFileSync('public/index.html', f);
console.log('✅ All quote bugs fixed!');

// Verify no more broken patterns
const check = fs.readFileSync('public/index.html', 'utf8');
const bad = (check.match(/""pending""|""in progress""|innerHTML="<div class="|innerHTML="<div style="/g) || []);
if (bad.length > 0) {
  console.log('⚠️ Still found potential issues:', bad);
} else {
  console.log('✅ No broken quote patterns found!');
}
