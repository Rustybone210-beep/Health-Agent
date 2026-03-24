const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SHARES_FILE = path.join(__dirname, "..", "data", "caregiver_shares.json");
const INVITES_FILE = path.join(__dirname, "..", "data", "share_invites.json");

function loadShares() {
  try {
    if (!fs.existsSync(SHARES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SHARES_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveShares(shares) {
  fs.writeFileSync(SHARES_FILE, JSON.stringify(shares, null, 2));
}

function loadInvites() {
  try {
    if (!fs.existsSync(INVITES_FILE)) return [];
    return JSON.parse(fs.readFileSync(INVITES_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveInvites(invites) {
  fs.writeFileSync(INVITES_FILE, JSON.stringify(invites, null, 2));
}

function createInvite(ownerId, ownerEmail, patientId, patientName, permission) {
  const invites = loadInvites();
  const code = crypto.randomBytes(16).toString("hex");
  const invite = {
    id: Date.now().toString(),
    code,
    ownerId,
    ownerEmail,
    patientId,
    patientName: patientName || "Patient",
    permission: permission || "view",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    used: false,
    usedBy: null
  };
  invites.push(invite);
  saveInvites(invites);
  return invite;
}

function acceptInvite(code, userId, userEmail) {
  const invites = loadInvites();
  const invite = invites.find(i => i.code === code && !i.used);
  if (!invite) throw new Error("Invalid or expired invite code");
  if (new Date(invite.expiresAt) < new Date()) throw new Error("Invite has expired");
  if (invite.ownerId === userId) throw new Error("You cannot accept your own invite");

  invite.used = true;
  invite.usedBy = userId;
  invite.usedAt = new Date().toISOString();
  saveInvites(invites);

  const shares = loadShares();
  const existing = shares.find(s => s.userId === userId && s.patientId === invite.patientId);
  if (existing) return existing;

  const share = {
    id: Date.now().toString(),
    userId,
    userEmail,
    ownerId: invite.ownerId,
    ownerEmail: invite.ownerEmail,
    patientId: invite.patientId,
    patientName: invite.patientName,
    permission: invite.permission,
    createdAt: new Date().toISOString(),
    active: true
  };
  shares.push(share);
  saveShares(shares);
  return share;
}

function getSharedPatients(userId) {
  const shares = loadShares();
  return shares.filter(s => s.userId === userId && s.active);
}

function getSharesForPatient(patientId) {
  const shares = loadShares();
  return shares.filter(s => s.patientId === patientId && s.active);
}

function revokeShare(shareId, ownerId) {
  const shares = loadShares();
  const share = shares.find(s => s.id === shareId && s.ownerId === ownerId);
  if (!share) throw new Error("Share not found");
  share.active = false;
  share.revokedAt = new Date().toISOString();
  saveShares(shares);
  return share;
}

function canAccessPatient(userId, patientId, patientsRaw) {
  const patients = patientsRaw || [];
  const owns = patients.some(p => p.id === patientId && (!p.ownerId || p.ownerId === userId));
  if (owns) return { access: true, permission: "owner" };
  const shares = loadShares();
  const share = shares.find(s => s.userId === userId && s.patientId === patientId && s.active);
  if (share) return { access: true, permission: share.permission };
  return { access: false, permission: null };
}

module.exports = { createInvite, acceptInvite, getSharedPatients, getSharesForPatient, revokeShare, canAccessPatient };
