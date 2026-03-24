
const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "data");

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const files = {
    "users.json": "[]",
    "sessions.json": "{}",
    "patients.json": '{"patients":[]}',
    "chat_history.json": "[]",
    "notifications.json": "[]",
    "tasks.json": "[]",
    "timeline.json": '{"events":[]}',
    "concerns.json": "[]",
    "lab_history.json": "[]",
    "symptom_log.json": "[]",
    "med_changes.json": "[]",
    "med_reminders.json": "[]",
    "reminder_log.json": "[]",
    "audit_log.json": "[]",
    "caregiver_shares.json": "[]",
    "share_invites.json": "[]",
    "health_data.json": "[]",
    "appointments.json": "[]",
    "ride_requests.json": "[]",
    "refill_requests.json": "[]",
    "saved_trials.json": "[]",
    "predictive_alerts.json": "[]",
    "mental_health_screenings.json": "[]",
    "advance_directives.json": "[]",
    "second_opinions.json": "[]",
    "insurance_claims.json": "[]",
    "ehr_config.json": '{"connections":[],"configured":false}',
    "network_providers.json": "[]",
    "network_connections.json": "[]",
    "priority_queue.json": "[]",
    "password_resets.json": "[]"
  };
  let created = 0;
  for (const [file, defaultContent] of Object.entries(files)) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, defaultContent);
      created++;
    }
  }
  if (created > 0) console.log("Created " + created + " missing data files");
}

module.exports = { ensureDataFiles };
