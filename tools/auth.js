const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const USERS_FILE = path.join(__dirname, "..", "data", "users.json");
const SESSIONS_FILE = path.join(__dirname, "..", "data", "sessions.json");
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  } catch (e) { return {}; }
}

function saveSessions(sessions) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

// Clean expired sessions (older than 30 days)
function cleanSessions() {
  const sessions = loadSessions();
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  let cleaned = 0;
  for (const token in sessions) {
    if (now - sessions[token].createdAt > maxAge) {
      delete sessions[token];
      cleaned++;
    }
  }
  if (cleaned > 0) saveSessions(sessions);
  return cleaned;
}

/**
 * Register a new user
 */
async function registerUser({ email, password, name, role, biometricEnabled }) {
  const users = loadUsers();
  const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) throw new Error("An account with this email already exists");

  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = {
    id: uuidv4(),
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    name: name || "",
    role: role || "caregiver",
    biometricEnabled: biometricEnabled || false,
    biometricCredentialId: null,
    createdAt: Date.now(),
    lastLogin: null,
    tier: "free",
    patientsAllowed: 1
  };

  users.push(user);
  saveUsers(users);

  const safeUser = { ...user };
  delete safeUser.password;
  return safeUser;
}

/**
 * Login with email + password
 */
async function loginWithPassword(email, password) {
  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error("Invalid email or password");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new Error("Invalid email or password");

  // Update last login
  user.lastLogin = Date.now();
  saveUsers(users);

  // Create session
  const token = uuidv4();
  const sessions = loadSessions();
  sessions[token] = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tier: user.tier,
    createdAt: Date.now()
  };
  saveSessions(sessions);

  const safeUser = { ...user };
  delete safeUser.password;
  return { token, user: safeUser };
}

/**
 * Login with biometric (WebAuthn credential ID)
 * The actual biometric check happens in the browser via Web Authentication API
 * We just verify the credential ID matches a registered user
 */
function loginWithBiometric(credentialId) {
  const users = loadUsers();
  const user = users.find(u => u.biometricCredentialId === credentialId);
  if (!user) throw new Error("Biometric not recognized. Please log in with your password.");

  user.lastLogin = Date.now();
  saveUsers(users);

  const token = uuidv4();
  const sessions = loadSessions();
  sessions[token] = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tier: user.tier,
    createdAt: Date.now()
  };
  saveSessions(sessions);

  const safeUser = { ...user };
  delete safeUser.password;
  return { token, user: safeUser };
}

/**
 * Register a biometric credential for an existing user
 */
function registerBiometric(userId, credentialId) {
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (!user) throw new Error("User not found");

  user.biometricEnabled = true;
  user.biometricCredentialId = credentialId;
  saveUsers(users);
  return true;
}

/**
 * Validate a session token
 */
function validateSession(token) {
  if (!token) return null;
  const sessions = loadSessions();
  const session = sessions[token];
  if (!session) return null;

  // Check expiry (30 days)
  if (Date.now() - session.createdAt > 30 * 24 * 60 * 60 * 1000) {
    delete sessions[token];
    saveSessions(sessions);
    return null;
  }

  return session;
}

/**
 * Logout — destroy session
 */
function logout(token) {
  const sessions = loadSessions();
  delete sessions[token];
  saveSessions(sessions);
  return true;
}

/**
 * Get user by ID (without password)
 */
function getUserById(id) {
  const users = loadUsers();
  const user = users.find(u => u.id === id);
  if (!user) return null;
  const safeUser = { ...user };
  delete safeUser.password;
  return safeUser;
}

/**
 * Update user tier/subscription
 */
function updateUserTier(userId, tier) {
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (!user) throw new Error("User not found");

  const tiers = {
    free: { patientsAllowed: 1 },
    pro: { patientsAllowed: 10 },
    family: { patientsAllowed: 5 }
  };

  user.tier = tier;
  user.patientsAllowed = tiers[tier]?.patientsAllowed || 1;
  saveUsers(users);

  const safeUser = { ...user };
  delete safeUser.password;
  return safeUser;
}

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "") ||
                req.cookies?.ha_session ||
                req.query?.token;

  const session = validateSession(token);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated", redirect: "/login" });
  }

  req.session = session;
  req.userId = session.userId;
  next();
}

module.exports = {
  registerUser,
  loginWithPassword,
  loginWithBiometric,
  registerBiometric,
  validateSession,
  logout,
  getUserById,
  updateUserTier,
  authMiddleware,
  cleanSessions
};

// ─── Password Reset ──────────────────────────────────────
const crypto = require("crypto");
const RESETS_FILE = path.join(__dirname, "..", "data", "password_resets.json");

function loadResets() {
  try { if (!fs.existsSync(RESETS_FILE)) return []; return JSON.parse(fs.readFileSync(RESETS_FILE, "utf8")); } catch(e) { return []; }
}

function createPasswordReset(email) {
  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return { token: "fake", userId: null, name: null };
  const token = crypto.randomBytes(32).toString("hex");
  let resets = loadResets();
  resets = resets.filter(r => r.email !== email.toLowerCase());
  resets.push({ email: email.toLowerCase(), token, userId: user.id, createdAt: Date.now(), expires: Date.now() + 3600000 });
  fs.writeFileSync(RESETS_FILE, JSON.stringify(resets, null, 2));
  return { token, userId: user.id, name: user.name };
}

function resetPassword(token, newPassword) {
  let resets = loadResets();
  const reset = resets.find(r => r.token === token && r.expires > Date.now());
  if (!reset) throw new Error("Invalid or expired reset link. Request a new one.");
  const users = loadUsers();
  const user = users.find(u => u.id === reset.userId);
  if (!user) throw new Error("User not found");
  user.password = bcrypt.hashSync(newPassword, 12);
  saveUsers(users);
  resets = resets.filter(r => r.token !== token);
  fs.writeFileSync(RESETS_FILE, JSON.stringify(resets, null, 2));
  return true;
}

module.exports.createPasswordReset = createPasswordReset;
module.exports.resetPassword = resetPassword;
