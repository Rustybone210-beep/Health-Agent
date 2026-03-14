const fs = require('fs');

const CONCERNS_FILE = './data/concerns.json';

function ensureStore() {
  try {
    if (!fs.existsSync('./data')) {
      fs.mkdirSync('./data', { recursive: true });
    }
    if (!fs.existsSync(CONCERNS_FILE)) {
      fs.writeFileSync(CONCERNS_FILE, JSON.stringify({ concerns: [] }, null, 2));
    }
  } catch (e) {}
}

function load() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(CONCERNS_FILE, 'utf8'));
  } catch (e) {
    return { concerns: [] };
  }
}

function save(data) {
  ensureStore();
  fs.writeFileSync(CONCERNS_FILE, JSON.stringify(data, null, 2));
}

function listConcerns(patientId = null) {
  const db = load();
  let concerns = db.concerns || [];
  if (patientId) {
    concerns = concerns.filter(c => c.patientId === patientId);
  }
  return concerns.filter(c => c.status !== 'resolved');
}

function addConcern(concern) {
  const db = load();

  const item = {
    id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
    patientId: concern.patientId || null,
    title: concern.title || 'Untitled Concern',
    description: concern.description || '',
    status: concern.status || 'active',
    priority: concern.priority || 'medium',
    source: concern.source || 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const duplicate = (db.concerns || []).find(existing =>
    existing.patientId === item.patientId &&
    existing.title === item.title &&
    existing.status !== 'resolved'
  );

  if (duplicate) return duplicate;

  db.concerns.unshift(item);
  save(db);
  return item;
}

function resolveConcern(id) {
  const db = load();
  const idx = db.concerns.findIndex(c => c.id === id);
  if (idx === -1) return null;

  db.concerns[idx] = {
    ...db.concerns[idx],
    status: 'resolved',
    updatedAt: new Date().toISOString()
  };

  save(db);
  return db.concerns[idx];
}

module.exports = {
  listConcerns,
  addConcern,
  resolveConcern
};
