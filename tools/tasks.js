const fs = require('fs');

const TASK_FILE = './data/tasks.json';

function load() {
  try {
    if (fs.existsSync(TASK_FILE)) {
      return JSON.parse(fs.readFileSync(TASK_FILE, 'utf8'));
    }
  } catch (e) {}
  return { tasks: [] };
}

function save(data) {
  fs.writeFileSync(TASK_FILE, JSON.stringify(data, null, 2));
}

function listTasks(patientId = null) {
  const db = load();
  let tasks = db.tasks || [];
  if (patientId) {
    tasks = tasks.filter(t => t.patientId === patientId);
  }
  return tasks;
}

function addTask(task) {
  const db = load();

  const t = {
    id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
    patientId: task.patientId || null,
    title: task.title || 'Untitled Task',
    description: task.description || '',
    dueDate: task.dueDate || null,
    priority: task.priority || 'medium',
    category: task.category || 'general',
    status: task.status || 'open',
    source: task.source || '',
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  const duplicate = (db.tasks || []).find(existing =>
    existing.patientId === t.patientId &&
    existing.title === t.title &&
    existing.description === t.description &&
    existing.status !== 'done'
  );

  if (duplicate) {
    return duplicate;
  }
  
  db.tasks.unshift(t);
  save(db);
  return t;
}

function bulkAddTasks(tasks, patientId) {
  const added = [];
  (tasks || []).forEach(task => {
    if (!task || !task.title) return;
    added.push(addTask({ ...task, patientId }));
  });
  return added;
}

function updateTask(id, updates) {
  const db = load();
  const i = db.tasks.findIndex(t => t.id === id);
  if (i === -1) return null;

  db.tasks[i] = { ...db.tasks[i], ...updates };
  save(db);
  return db.tasks[i];
}

function deleteTask(id) {
  const db = load();
  db.tasks = db.tasks.filter(t => t.id !== id);
  save(db);
}

module.exports = {
  listTasks,
  addTask,
  bulkAddTasks,
  updateTask,
  deleteTask
};
