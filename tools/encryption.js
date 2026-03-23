const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const KEY_FILE = path.join(__dirname, '..', '.encryption-key');

/**
 * Get or create encryption key
 * In production, this should come from an environment variable
 */
function getKey() {
  // Check environment variable first
  if (process.env.ENCRYPTION_KEY) {
    const keyBuf = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    if (keyBuf.length === 32) return keyBuf;
  }

  // Fall back to key file
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  }

  // Generate new key
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), 'utf8');
  console.log('🔐 New encryption key generated and saved to .encryption-key');
  console.log('   For production, set ENCRYPTION_KEY environment variable instead.');
  return key;
}

/**
 * Encrypt a string
 * @param {string} plaintext - Data to encrypt
 * @returns {string} Encrypted data as base64 string with IV and auth tag
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string
 * @param {string} encryptedStr - Data from encrypt()
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedStr) {
  const key = getKey();
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted data format');

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedData = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Encrypt a JSON object
 * @param {object} data - Object to encrypt
 * @returns {string} Encrypted string
 */
function encryptJSON(data) {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypt to a JSON object
 * @param {string} encryptedStr - Encrypted string from encryptJSON
 * @returns {object} Decrypted object
 */
function decryptJSON(encryptedStr) {
  return JSON.parse(decrypt(encryptedStr));
}

/**
 * Read a JSON file, decrypting if encrypted
 * Falls back to plain JSON for backward compatibility
 * @param {string} filePath - Path to the file
 * @param {*} fallback - Default value if file doesn't exist
 * @returns {*} Parsed data
 */
function readSecureJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8').trim();

    // Check if it's encrypted (format: hex:hex:hex)
    if (/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(raw)) {
      return decryptJSON(raw);
    }

    // Plain JSON (backward compatible)
    return JSON.parse(raw);
  } catch (e) {
    console.log('readSecureJSON error for', filePath, ':', e.message);
    return fallback;
  }
}

/**
 * Write a JSON file with encryption
 * @param {string} filePath - Path to write
 * @param {*} data - Data to encrypt and write
 * @param {boolean} shouldEncrypt - Whether to encrypt (default: true)
 */
function writeSecureJSON(filePath, data, shouldEncrypt = true) {
  if (shouldEncrypt) {
    fs.writeFileSync(filePath, encryptJSON(data), 'utf8');
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
}

/**
 * Encrypt all existing plain JSON data files
 * Run once to migrate from plain to encrypted
 */
function encryptExistingData(dataDir) {
  const dir = dataDir || path.join(__dirname, '..', 'data');
  const files = ['patients.json', 'chat_history.json', 'notifications.json',
                 'timeline.json', 'tasks.json', 'concerns.json'];
  let encrypted = 0;

  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) return;

    const raw = fs.readFileSync(filePath, 'utf8').trim();
    // Skip if already encrypted
    if (/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(raw)) {
      console.log(`  ✅ ${file} — already encrypted`);
      return;
    }

    try {
      const data = JSON.parse(raw);
      // Backup first
      fs.writeFileSync(filePath + '.backup', raw, 'utf8');
      // Encrypt
      writeSecureJSON(filePath, data, true);
      encrypted++;
      console.log(`  🔐 ${file} — encrypted`);
    } catch (e) {
      console.log(`  ⚠️  ${file} — skipped (${e.message})`);
    }
  });

  return encrypted;
}

/**
 * Decrypt all data files back to plain JSON
 * Use for debugging or migration
 */
function decryptAllData(dataDir) {
  const dir = dataDir || path.join(__dirname, '..', 'data');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const raw = fs.readFileSync(filePath, 'utf8').trim();

    if (/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(raw)) {
      try {
        const data = decryptJSON(raw);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`  🔓 ${file} — decrypted`);
      } catch (e) {
        console.log(`  ⚠️  ${file} — failed (${e.message})`);
      }
    } else {
      console.log(`  ℹ️  ${file} — already plain`);
    }
  });
}

module.exports = {
  encrypt, decrypt,
  encryptJSON, decryptJSON,
  readSecureJSON, writeSecureJSON,
  encryptExistingData, decryptAllData,
  getKey
};
