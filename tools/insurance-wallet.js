const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname,'../data/insurance_cards.json');

function load() {
  try { if(!fs.existsSync(DATA_FILE)) return []; return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch(e) { return []; }
}
function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2)); }

function addCard(patientId, cardData) {
  const cards = load();
  const card = { id: Date.now().toString(), patientId, ...cardData, addedAt: new Date().toISOString(), lastUsed: null };
  cards.unshift(card);
  save(cards);
  return card;
}

function getCards(patientId) {
  return load().filter(c => c.patientId === patientId);
}

function markUsed(cardId) {
  const cards = load();
  const idx = cards.findIndex(c => c.id === cardId);
  if(idx !== -1) { cards[idx].lastUsed = new Date().toISOString(); save(cards); }
}

function deleteCard(cardId) {
  const cards = load().filter(c => c.id !== cardId);
  save(cards);
}

function buildQuickShareText(patientId, patient) {
  const cards = getCards(patientId);
  const p = patient || {};
  let text = `INSURANCE INFO FOR: ${p.name||'Patient'}\n`;
  text += `DOB: ${p.dob||'Unknown'}\n\n`;
  cards.forEach(card => {
    text += `${card.insurance_company||card.plan_name||'Insurance'}\n`;
    if(card.member_id) text += `Member ID: ${card.member_id}\n`;
    if(card.group_number) text += `Group: ${card.group_number}\n`;
    if(card.rx_bin) text += `RX BIN: ${card.rx_bin} | PCN: ${card.rx_pcn||''}\n`;
    text += '\n';
  });
  return text.trim();
}

module.exports = { addCard, getCards, markUsed, deleteCard, buildQuickShareText };
