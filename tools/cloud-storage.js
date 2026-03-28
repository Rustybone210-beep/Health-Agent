// ============================================================
// cloud-storage.js — Google Cloud Storage sync for data persistence
//
// On startup: downloads all JSON files from GCS bucket to local data/
// After every write: uploads the changed file back to GCS
// This ensures data survives Cloud Run container restarts.
// ============================================================

const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

const BUCKET_NAME = process.env.GCS_BUCKET || 'healthagent-data-719697980755';
const DATA_DIR = path.join(__dirname, '..', 'data');

let storage = null;
let bucket = null;
let enabled = false;

try {
  storage = new Storage();
  bucket = storage.bucket(BUCKET_NAME);
  enabled = true;
  console.log('[GCS] Cloud Storage enabled — bucket:', BUCKET_NAME);
} catch (e) {
  console.log('[GCS] Cloud Storage not available — running with local files only');
}

/**
 * Download all data files from GCS to local data/ directory
 * Called once on server startup
 */
async function downloadAll() {
  if (!enabled) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const [files] = await bucket.getFiles({ prefix: 'data/' });
    let downloaded = 0;

    for (const file of files) {
      const localName = file.name.replace('data/', '');
      if (!localName || localName.includes('/')) continue; // skip subdirs

      const localPath = path.join(DATA_DIR, localName);
      try {
        const [contents] = await file.download();
        fs.writeFileSync(localPath, contents);
        downloaded++;
      } catch (e) {
        console.log('[GCS] Failed to download', localName, ':', e.message);
      }
    }

    console.log('[GCS] Downloaded', downloaded, 'files from cloud storage');
  } catch (e) {
    console.log('[GCS] Download all failed:', e.message);
  }
}

/**
 * Upload a single file to GCS after a local write
 * Called after every data save operation
 */
async function uploadFile(filename) {
  if (!enabled) return;
  const localPath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(localPath)) return;

  try {
    await bucket.upload(localPath, {
      destination: 'data/' + filename,
      metadata: { contentType: 'application/json' }
    });
  } catch (e) {
    console.log('[GCS] Upload failed for', filename, ':', e.message);
  }
}

/**
 * Sync a file after writing — non-blocking
 * Use this wrapper so writes don't slow down the API
 */
function syncAfterWrite(filename) {
  if (!enabled) return;
  uploadFile(filename).catch(() => {});
}

/**
 * Upload all local data files to GCS (for initial seed or backup)
 */
async function uploadAll() {
  if (!enabled) return;
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    let uploaded = 0;
    for (const f of files) {
      await uploadFile(f);
      uploaded++;
    }
    console.log('[GCS] Uploaded', uploaded, 'files to cloud storage');
  } catch (e) {
    console.log('[GCS] Upload all failed:', e.message);
  }
}

module.exports = { downloadAll, uploadFile, syncAfterWrite, uploadAll, enabled };
