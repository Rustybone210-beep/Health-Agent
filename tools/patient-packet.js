const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PACKETS_DIR = path.join(__dirname, "..", "data", "packets");
const SHARE_LINKS_FILE = path.join(__dirname, "..", "data", "share_links.json");

function ensurePacketsDir() {
  if (!fs.existsSync(PACKETS_DIR)) fs.mkdirSync(PACKETS_DIR, { recursive: true });
}

function generatePatientPacket(patient) {
  if (!patient) throw new Error("No patient data");

  const age = calcAge(patient.dob);
  const packet = {
    generatedAt: new Date().toISOString(),
    generatedDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    patient: {
      fullName: patient.name || "",
      dateOfBirth: patient.dob || "",
      age: age,
      gender: patient.gender || "",
      address: patient.address || "",
      phone: patient.phone || "",
      email: patient.email || "",
      ssn_last4: patient.ssn_last4 || "",
      emergencyContact: patient.emergencyContact || {},
      relationship: patient.relationship || ""
    },
    insurance: {
      primary: {
        company: patient.insurance?.primary || "",
        planName: patient.insurance?.planName || "",
        memberId: patient.insurance?.memberId || "",
        groupNumber: patient.insurance?.groupNumber || "",
        phone: patient.insurance?.phone || "",
        effectiveDate: patient.insurance?.effectiveDate || ""
      },
      secondary: {
        company: patient.insurance?.secondary || "",
        memberId: patient.insurance?.secondaryMemberId || "",
        groupNumber: patient.insurance?.secondaryGroupNumber || ""
      }
    },
    medicalHistory: {
      conditions: patient.conditions || [],
      surgicalHistory: patient.surgicalHistory || [],
      familyHistory: patient.familyHistory || [],
      allergies: (patient.allergies || []).map(a => typeof a === "string" ? { allergen: a, reaction: "", severity: "" } : a)
    },
    medications: (patient.medications || []).map(m => ({
      name: m.name || "",
      dose: m.dose || "",
      frequency: m.frequency || "",
      prescriber: m.prescriber || "",
      reason: m.reason || ""
    })),
    providers: {
      primaryCare: {
        name: patient.primaryDoctor || "",
        clinic: patient.clinic || "",
        phone: patient.doctorPhone || ""
      },
      specialists: patient.specialists || [],
      pharmacy: {
        name: patient.pharmacy?.name || "",
        phone: patient.pharmacy?.phone || "",
        address: patient.pharmacy?.address || ""
      },
      preferredHospital: patient.preferredHospital || ""
    },
    preferences: {
      language: patient.language || "English",
      interpreter: patient.needsInterpreter || false,
      mobility: patient.mobilityNeeds || "",
      advanceDirective: patient.hasAdvanceDirective || false,
      organDonor: patient.organDonor || null
    }
  };

  return packet;
}

function formatPacketAsText(packet) {
  let t = "";
  t += "═══════════════════════════════════════════════════════\n";
  t += "           PATIENT INFORMATION PACKET\n";
  t += "           Generated: " + packet.generatedDate + "\n";
  t += "           Powered by Health Agent\n";
  t += "═══════════════════════════════════════════════════════\n\n";

  t += "PATIENT INFORMATION\n";
  t += "───────────────────────────────────────────────────────\n";
  t += "Name:           " + packet.patient.fullName + "\n";
  t += "Date of Birth:  " + packet.patient.dateOfBirth + "\n";
  t += "Age:            " + (packet.patient.age || "—") + "\n";
  t += "Address:        " + (packet.patient.address || "—") + "\n";
  t += "Phone:          " + (packet.patient.phone || "—") + "\n";
  t += "Email:          " + (packet.patient.email || "—") + "\n\n";

  t += "INSURANCE — PRIMARY\n";
  t += "───────────────────────────────────────────────────────\n";
  t += "Company:        " + (packet.insurance.primary.company || "—") + "\n";
  t += "Plan:           " + (packet.insurance.primary.planName || "—") + "\n";
  t += "Member ID:      " + (packet.insurance.primary.memberId || "—") + "\n";
  t += "Group Number:   " + (packet.insurance.primary.groupNumber || "—") + "\n";
  t += "Effective:      " + (packet.insurance.primary.effectiveDate || "—") + "\n\n";

  if (packet.insurance.secondary.company) {
    t += "INSURANCE — SECONDARY\n";
    t += "───────────────────────────────────────────────────────\n";
    t += "Company:        " + packet.insurance.secondary.company + "\n";
    t += "Member ID:      " + (packet.insurance.secondary.memberId || "—") + "\n";
    t += "Group Number:   " + (packet.insurance.secondary.groupNumber || "—") + "\n\n";
  }

  t += "MEDICAL CONDITIONS\n";
  t += "───────────────────────────────────────────────────────\n";
  if (packet.medicalHistory.conditions.length > 0) {
    packet.medicalHistory.conditions.forEach(c => { t += "  • " + c + "\n"; });
  } else { t += "  None reported\n"; }
  t += "\n";

  t += "ALLERGIES\n";
  t += "───────────────────────────────────────────────────────\n";
  if (packet.medicalHistory.allergies.length > 0) {
    packet.medicalHistory.allergies.forEach(a => {
      t += "  ⚠️  " + (a.allergen || a) + (a.reaction ? " — Reaction: " + a.reaction : "") + "\n";
    });
  } else { t += "  NKDA (No Known Drug Allergies)\n"; }
  t += "\n";

  t += "CURRENT MEDICATIONS\n";
  t += "───────────────────────────────────────────────────────\n";
  if (packet.medications.length > 0) {
    packet.medications.forEach(m => {
      t += "  • " + m.name + (m.dose ? " " + m.dose : "") + (m.frequency ? " — " + m.frequency : "") + "\n";
    });
  } else { t += "  None reported\n"; }
  t += "\n";

  if (packet.medicalHistory.surgicalHistory && packet.medicalHistory.surgicalHistory.length > 0) {
    t += "SURGICAL HISTORY\n";
    t += "───────────────────────────────────────────────────────\n";
    packet.medicalHistory.surgicalHistory.forEach(s => { t += "  • " + s + "\n"; });
    t += "\n";
  }

  t += "CARE TEAM\n";
  t += "───────────────────────────────────────────────────────\n";
  t += "Primary Doctor: " + (packet.providers.primaryCare.name || "—") + "\n";
  t += "Clinic:         " + (packet.providers.primaryCare.clinic || "—") + "\n";
  t += "Phone:          " + (packet.providers.primaryCare.phone || "—") + "\n";
  t += "Pharmacy:       " + (packet.providers.pharmacy.name || "—") + " " + (packet.providers.pharmacy.phone || "") + "\n";
  t += "Hospital:       " + (packet.providers.preferredHospital || "—") + "\n\n";

  t += "═══════════════════════════════════════════════════════\n";
  t += "This packet was generated by Health Agent.\n";
  t += "All information provided by the patient/caregiver.\n";
  t += "Verify with original documents as needed.\n";
  t += "═══════════════════════════════════════════════════════\n";
  return t;
}

function formatPacketAsHTML(packet) {
  let h = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Patient Packet — ' + (packet.patient.fullName || 'Patient') + '</title>';
  h += '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;padding:20px;max-width:700px;margin:0 auto}';
  h += '.header{text-align:center;padding:24px 0;border-bottom:2px solid #2dd4bf;margin-bottom:24px}.header h1{font-size:24px;color:#2dd4bf}.header p{color:#94a3b8;font-size:13px;margin-top:4px}';
  h += '.section{margin-bottom:20px;background:rgba(30,41,59,0.8);border:1px solid rgba(45,212,191,0.12);border-radius:16px;padding:16px;backdrop-filter:blur(12px)}';
  h += '.section h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#2dd4bf;margin-bottom:12px}';
  h += '.row{display:flex;gap:8px;margin-bottom:6px;font-size:14px}.label{width:120px;flex-shrink:0;color:#64748b;font-size:12px}.value{color:#f1f5f9}';
  h += '.pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;margin:2px}.pill-teal{background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.2);color:#2dd4bf}';
  h += '.pill-red{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);color:#f87171}';
  h += '.med{padding:8px 12px;background:rgba(51,65,85,0.4);border-radius:10px;margin-bottom:6px;font-size:13px}.med strong{color:#f1f5f9}.med span{color:#94a3b8}';
  h += '.footer{text-align:center;padding:20px 0;color:#64748b;font-size:11px;border-top:1px solid rgba(45,212,191,0.12);margin-top:24px}';
  h += '@media print{body{background:#fff;color:#000}.section{background:#f8f8f8;border:1px solid #ddd}.label{color:#666}.value{color:#000}.pill-teal{background:#e0f7f0;color:#0a5c4a}.pill-red{background:#fde8e8;color:#b91c1c}.header h1{color:#0a5c4a}.footer{color:#999}}</style></head><body>';

  h += '<div class="header"><h1>Health Agent</h1><p>Patient Information Packet — ' + packet.generatedDate + '</p></div>';

  h += '<div class="section"><h2>Patient Information</h2>';
  h += '<div class="row"><span class="label">Name</span><span class="value">' + (packet.patient.fullName || '—') + '</span></div>';
  h += '<div class="row"><span class="label">Date of Birth</span><span class="value">' + (packet.patient.dateOfBirth || '—') + ' (Age ' + (packet.patient.age || '?') + ')</span></div>';
  h += '<div class="row"><span class="label">Address</span><span class="value">' + (packet.patient.address || '—') + '</span></div>';
  h += '<div class="row"><span class="label">Phone</span><span class="value">' + (packet.patient.phone || '—') + '</span></div>';
  h += '</div>';

  h += '<div class="section"><h2>Insurance — Primary</h2>';
  h += '<div class="row"><span class="label">Company</span><span class="value">' + (packet.insurance.primary.company || '—') + '</span></div>';
  h += '<div class="row"><span class="label">Member ID</span><span class="value">' + (packet.insurance.primary.memberId || '—') + '</span></div>';
  h += '<div class="row"><span class="label">Group</span><span class="value">' + (packet.insurance.primary.groupNumber || '—') + '</span></div>';
  h += '</div>';

  if (packet.insurance.secondary.company) {
    h += '<div class="section"><h2>Insurance — Secondary</h2>';
    h += '<div class="row"><span class="label">Company</span><span class="value">' + packet.insurance.secondary.company + '</span></div>';
    h += '<div class="row"><span class="label">Member ID</span><span class="value">' + (packet.insurance.secondary.memberId || '—') + '</span></div>';
    h += '</div>';
  }

  h += '<div class="section"><h2>Conditions</h2>';
  if (packet.medicalHistory.conditions.length > 0) {
    packet.medicalHistory.conditions.forEach(c => { h += '<span class="pill pill-teal">' + c + '</span> '; });
  } else { h += '<span style="color:#64748b;font-size:13px">None reported</span>'; }
  h += '</div>';

  h += '<div class="section"><h2>Allergies</h2>';
  if (packet.medicalHistory.allergies.length > 0) {
    packet.medicalHistory.allergies.forEach(a => { h += '<span class="pill pill-red">⚠️ ' + (a.allergen || a) + '</span> '; });
  } else { h += '<span style="color:#64748b;font-size:13px">NKDA (No Known Drug Allergies)</span>'; }
  h += '</div>';

  h += '<div class="section"><h2>Current Medications</h2>';
  if (packet.medications.length > 0) {
    packet.medications.forEach(m => {
      h += '<div class="med"><strong>' + m.name + '</strong> ' + (m.dose || '') + ' <span>' + (m.frequency || '') + '</span></div>';
    });
  } else { h += '<span style="color:#64748b;font-size:13px">None reported</span>'; }
  h += '</div>';

  h += '<div class="section"><h2>Care Team</h2>';
  h += '<div class="row"><span class="label">Primary Doctor</span><span class="value">' + (packet.providers.primaryCare.name || '—') + '</span></div>';
  h += '<div class="row"><span class="label">Clinic</span><span class="value">' + (packet.providers.primaryCare.clinic || '—') + '</span></div>';
  h += '<div class="row"><span class="label">Pharmacy</span><span class="value">' + (packet.providers.pharmacy.name || '—') + ' ' + (packet.providers.pharmacy.phone || '') + '</span></div>';
  h += '</div>';

  h += '<div class="footer">Generated by Health Agent — Verify with original documents as needed</div>';
  h += '</body></html>';
  return h;
}

function createShareLink(patientId, packet, expiresHours) {
  let links = [];
  try { if (fs.existsSync(SHARE_LINKS_FILE)) links = JSON.parse(fs.readFileSync(SHARE_LINKS_FILE, "utf8")); } catch(e) {}

  const token = crypto.randomBytes(24).toString("hex");
  const link = {
    token,
    patientId,
    patientName: packet.patient.fullName,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (expiresHours || 24) * 60 * 60 * 1000).toISOString(),
    accessed: false,
    accessCount: 0
  };

  // Save the packet HTML
  ensurePacketsDir();
  fs.writeFileSync(path.join(PACKETS_DIR, token + ".html"), formatPacketAsHTML(packet));

  links.push(link);
  fs.writeFileSync(SHARE_LINKS_FILE, JSON.stringify(links, null, 2));
  return { token, link };
}

function getSharedPacket(token) {
  let links = [];
  try { if (fs.existsSync(SHARE_LINKS_FILE)) links = JSON.parse(fs.readFileSync(SHARE_LINKS_FILE, "utf8")); } catch(e) {}
  const link = links.find(l => l.token === token);
  if (!link) throw new Error("Invalid or expired link");
  if (new Date(link.expiresAt) < new Date()) throw new Error("This link has expired");

  link.accessed = true;
  link.accessCount = (link.accessCount || 0) + 1;
  link.lastAccessed = new Date().toISOString();
  fs.writeFileSync(SHARE_LINKS_FILE, JSON.stringify(links, null, 2));

  const packetPath = path.join(PACKETS_DIR, token + ".html");
  if (!fs.existsSync(packetPath)) throw new Error("Packet not found");
  return fs.readFileSync(packetPath, "utf8");
}

function generateQRData(patient, baseUrl) {
  const packet = generatePatientPacket(patient);
  const result = createShareLink(patient.id, packet, 72);
  const url = baseUrl + "/shared/" + result.token;
  return { url, token: result.token, expiresIn: "72 hours" };
}

function calcAge(dob) {
  if (!dob) return null;
  try {
    let b;
    if (dob.includes("/")) { const p = dob.split("/"); b = new Date(p[2] + "-" + String(p[0]).padStart(2,"0") + "-" + String(p[1]).padStart(2,"0")); }
    else b = new Date(dob);
    if (isNaN(b.getTime())) return null;
    return Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000));
  } catch(e) { return null; }
}

module.exports = { generatePatientPacket, formatPacketAsText, formatPacketAsHTML, createShareLink, getSharedPacket, generateQRData };
