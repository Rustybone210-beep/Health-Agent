const fs = require("fs");
const path = require("path");
const AUDIT_FILE = path.join(__dirname, "..", "data", "audit_log.json");
const MAX_ENTRIES = 10000;

function log(entry) {
  let logs = [];
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      logs = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
    }
  } catch (e) { logs = []; }

  logs.push({
    id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
    timestamp: new Date().toISOString(),
    action: entry.action || "unknown",
    userId: entry.userId || null,
    userEmail: entry.userEmail || null,
    patientId: entry.patientId || null,
    resource: entry.resource || null,
    method: entry.method || null,
    path: entry.path || null,
    ip: entry.ip || null,
    userAgent: entry.userAgent || null,
    details: entry.details || null,
    phi_accessed: entry.phi_accessed || false,
    success: entry.success !== undefined ? entry.success : true
  });

  if (logs.length > MAX_ENTRIES) {
    const archive = path.join(__dirname, "..", "data", "audit_archive_" + Date.now() + ".json");
    fs.writeFileSync(archive, JSON.stringify(logs.slice(0, logs.length - MAX_ENTRIES), null, 2));
    logs = logs.slice(-MAX_ENTRIES);
  }

  fs.writeFileSync(AUDIT_FILE, JSON.stringify(logs, null, 2));
}

function logAccess(req, action, details) {
  log({
    action,
    userId: req.userId || req.userSession?.userId || null,
    userEmail: req.userSession?.email || null,
    patientId: req.body?.patientId || req.query?.patientId || null,
    resource: req.path,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip || req.connection?.remoteAddress || null,
    userAgent: req.headers?.["user-agent"]?.substring(0, 200) || null,
    details,
    phi_accessed: true
  });
}

function logAuth(action, email, success, ip, details) {
  log({
    action,
    userEmail: email,
    ip,
    success,
    details,
    phi_accessed: false
  });
}

function logDataChange(userId, action, resource, patientId, details) {
  log({
    action,
    userId,
    resource,
    patientId,
    details,
    phi_accessed: true
  });
}

function getAuditLog(filters) {
  let logs = [];
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      logs = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
    }
  } catch (e) { return []; }

  if (filters) {
    if (filters.userId) logs = logs.filter(l => l.userId === filters.userId);
    if (filters.patientId) logs = logs.filter(l => l.patientId === filters.patientId);
    if (filters.action) logs = logs.filter(l => l.action === filters.action);
    if (filters.since) {
      const since = new Date(filters.since).getTime();
      logs = logs.filter(l => new Date(l.timestamp).getTime() >= since);
    }
    if (filters.phi_only) logs = logs.filter(l => l.phi_accessed);
  }

  return logs.slice(-(filters?.limit || 100)).reverse();
}

function auditMiddleware(req, res, next) {
  if (req.path.startsWith("/api/auth/")) return next();
  if (req.method === "GET" && !req.path.includes("patient") && !req.path.includes("summary")) return next();
  logAccess(req, req.method + " " + req.path, null);
  next();
}

module.exports = { log, logAccess, logAuth, logDataChange, getAuditLog, auditMiddleware };
