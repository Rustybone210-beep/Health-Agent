const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "..", "data");
const BACKUP_DIR = path.join(__dirname, "..", "data", "backups");

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function createBackup() {
  ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const backupPath = path.join(BACKUP_DIR, "backup-" + timestamp);
  fs.mkdirSync(backupPath, { recursive: true });

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  let count = 0;
  for (const file of files) {
    const src = path.join(DATA_DIR, file);
    const dest = path.join(backupPath, file);
    try {
      fs.copyFileSync(src, dest);
      count++;
    } catch (e) {}
  }

  cleanOldBackups(10);
  return { path: backupPath, files: count, timestamp };
}

function cleanOldBackups(keep) {
  ensureBackupDir();
  const dirs = fs.readdirSync(BACKUP_DIR)
    .filter(d => d.startsWith("backup-"))
    .sort()
    .reverse();
  for (let i = keep; i < dirs.length; i++) {
    const dirPath = path.join(BACKUP_DIR, dirs[i]);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (e) {}
  }
}

function restoreBackup(timestamp) {
  const backupPath = path.join(BACKUP_DIR, "backup-" + timestamp);
  if (!fs.existsSync(backupPath)) throw new Error("Backup not found: " + timestamp);
  const files = fs.readdirSync(backupPath).filter(f => f.endsWith(".json"));
  let count = 0;
  for (const file of files) {
    const src = path.join(backupPath, file);
    const dest = path.join(DATA_DIR, file);
    try {
      fs.copyFileSync(src, dest);
      count++;
    } catch (e) {}
  }
  return { restored: count, from: timestamp };
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(d => d.startsWith("backup-"))
    .sort()
    .reverse()
    .map(d => {
      const files = fs.readdirSync(path.join(BACKUP_DIR, d)).length;
      return { name: d, timestamp: d.replace("backup-", ""), files };
    });
}

module.exports = { createBackup, restoreBackup, listBackups, cleanOldBackups };
