// push-notifications.js — Real browser push notifications
const fs = require('fs');
const path = require('path');

const SUBSCRIPTIONS_FILE = path.join(__dirname,'../data/push_subscriptions.json');

function load(file, fb) {
  try { if(!fs.existsSync(file)) return fb; return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) { return fb; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data,null,2)); }

function saveSubscription(userId, patientId, subscription) {
  const subs = load(SUBSCRIPTIONS_FILE, {});
  if(!subs[userId]) subs[userId] = [];
  const exists = subs[userId].findIndex(s => s.endpoint === subscription.endpoint);
  if(exists >= 0) subs[userId][exists] = { ...subscription, patientId, updatedAt: new Date().toISOString() };
  else subs[userId].push({ ...subscription, patientId, createdAt: new Date().toISOString() });
  save(SUBSCRIPTIONS_FILE, subs);
}

function getSubscriptions(userId) {
  const subs = load(SUBSCRIPTIONS_FILE, {});
  return subs[userId] || [];
}

function getAllSubscriptions() {
  const subs = load(SUBSCRIPTIONS_FILE, {});
  return Object.entries(subs).flatMap(([userId, userSubs]) =>
    userSubs.map(s => ({ ...s, userId }))
  );
}

function removeSubscription(userId, endpoint) {
  const subs = load(SUBSCRIPTIONS_FILE, {});
  if(subs[userId]) subs[userId] = subs[userId].filter(s => s.endpoint !== endpoint);
  save(SUBSCRIPTIONS_FILE, subs);
}

// Build notification payload
function buildNotification(type, title, body, data = {}) {
  const icons = {
    medication: '/icons/icon-192.png',
    emergency: '/icons/icon-192.png',
    appointment: '/icons/icon-192.png',
    alert: '/icons/icon-192.png',
    briefing: '/icons/icon-192.png'
  };
  return {
    title,
    body,
    icon: icons[type] || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: type + '_' + Date.now(),
    requireInteraction: type === 'emergency',
    data: { url: data.url || '/', ...data },
    actions: data.actions || []
  };
}

module.exports = {
  saveSubscription, getSubscriptions,
  getAllSubscriptions, removeSubscription,
  buildNotification
};
