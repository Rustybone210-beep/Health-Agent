const fs = require("fs");
const path = require("path");

function generateCheckInSheet(patient) {
  if (!patient) throw new Error("No patient data");
  const age = calcAge(patient.dob);

  const sheet = {
    title: "Check-In Cheat Sheet — " + (patient.name || "Patient"),
    generatedAt: new Date().toISOString(),
    instructions: "Open this side-by-side with any clinic form. Copy and paste each field.",
    sections: [
      {
        title: "Patient Demographics",
        fields: [
          { label: "Full Legal Name", value: patient.name || "", copyable: true },
          { label: "First Name", value: (patient.name || "").split(" ")[0] || "", copyable: true },
          { label: "Last Name", value: (patient.name || "").split(" ").slice(1).join(" ") || "", copyable: true },
          { label: "Date of Birth", value: patient.dob || "", copyable: true },
          { label: "Age", value: age ? String(age) : "", copyable: true },
          { label: "Gender / Sex", value: patient.gender || "", copyable: true },
          { label: "Phone Number", value: patient.phone || "", copyable: true },
          { label: "Email", value: patient.email || "", copyable: true },
          { label: "Address", value: patient.address || "", copyable: true },
          { label: "City", value: extractCity(patient.address) || "", copyable: true },
          { label: "State", value: extractState(patient.address) || "", copyable: true },
          { label: "ZIP Code", value: extractZip(patient.address) || "", copyable: true },
          { label: "Preferred Language", value: patient.language || "English", copyable: true },
          { label: "Marital Status", value: patient.maritalStatus || "", copyable: true },
          { label: "Race/Ethnicity", value: patient.ethnicity || "", copyable: true }
        ]
      },
      {
        title: "Emergency Contact",
        fields: [
          { label: "Emergency Contact Name", value: patient.emergencyContact?.name || "", copyable: true },
          { label: "Relationship", value: patient.emergencyContact?.relationship || patient.relationship || "", copyable: true },
          { label: "Emergency Phone", value: patient.emergencyContact?.phone || "", copyable: true }
        ]
      },
      {
        title: "Insurance — Primary",
        fields: [
          { label: "Insurance Company", value: patient.insurance?.primary || "", copyable: true },
          { label: "Plan Name", value: patient.insurance?.planName || "", copyable: true },
          { label: "Member / Subscriber ID", value: patient.insurance?.memberId || "", copyable: true },
          { label: "Group Number", value: patient.insurance?.groupNumber || "", copyable: true },
          { label: "Policy Holder Name", value: patient.insurance?.policyHolder || patient.name || "", copyable: true },
          { label: "Effective Date", value: patient.insurance?.effectiveDate || "", copyable: true },
          { label: "Insurance Phone", value: patient.insurance?.phone || "", copyable: true }
        ]
      },
      {
        title: "Insurance — Secondary",
        fields: [
          { label: "Insurance Company", value: patient.insurance?.secondary || "", copyable: true },
          { label: "Member ID", value: patient.insurance?.secondaryMemberId || "", copyable: true },
          { label: "Group Number", value: patient.insurance?.secondaryGroupNumber || "", copyable: true }
        ]
      },
      {
        title: "Primary Care Provider",
        fields: [
          { label: "Primary Doctor", value: patient.primaryDoctor || "", copyable: true },
          { label: "Clinic Name", value: patient.clinic || "", copyable: true },
          { label: "Doctor Phone", value: patient.doctorPhone || "", copyable: true },
          { label: "Referring Doctor", value: patient.referringDoctor || patient.primaryDoctor || "", copyable: true }
        ]
      },
      {
        title: "Pharmacy",
        fields: [
          { label: "Pharmacy Name", value: patient.pharmacy?.name || "", copyable: true },
          { label: "Pharmacy Phone", value: patient.pharmacy?.phone || "", copyable: true },
          { label: "Pharmacy Address", value: patient.pharmacy?.address || "", copyable: true }
        ]
      },
      {
        title: "Medical Conditions — Check all that apply",
        fields: (patient.conditions || []).map(c => ({ label: c, value: "YES", copyable: false })),
        note: "Check these boxes on the form: " + (patient.conditions || []).join(", ")
      },
      {
        title: "Allergies",
        fields: (patient.allergies || []).map(a => ({
          label: typeof a === "string" ? a : a.allergen,
          value: typeof a === "string" ? a : (a.allergen + (a.reaction ? " — " + a.reaction : "")),
          copyable: true
        })),
        note: (patient.allergies || []).length === 0 ? "NKDA — No Known Drug Allergies" : "List: " + (patient.allergies || []).join(", ")
      },
      {
        title: "Current Medications — Copy this entire list",
        fields: (patient.medications || []).map(m => ({
          label: m.name + (m.dose ? " " + m.dose : ""),
          value: m.name + (m.dose ? " " + m.dose : "") + (m.frequency ? " — " + m.frequency : ""),
          copyable: true
        })),
        copyAll: (patient.medications || []).map(m =>
          m.name + (m.dose ? " " + m.dose : "") + (m.frequency ? " " + m.frequency : "")
        ).join("\n")
      },
      {
        title: "Surgical History",
        fields: (patient.surgicalHistory || []).map(s => ({ label: s, value: s, copyable: true })),
        copyAll: (patient.surgicalHistory || []).join("\n") || "None"
      },
      {
        title: "Common Form Questions — Quick Answers",
        fields: [
          { label: "Do you smoke?", value: patient.smoker || "No", copyable: false },
          { label: "Do you drink alcohol?", value: patient.alcohol || "", copyable: false },
          { label: "Are you pregnant?", value: patient.pregnant || "No", copyable: false },
          { label: "Do you have a living will / advance directive?", value: patient.hasAdvanceDirective ? "Yes" : "No", copyable: false },
          { label: "Organ donor?", value: patient.organDonor || "", copyable: false },
          { label: "Fall risk?", value: patient.fallRisk || "", copyable: false },
          { label: "Hearing aids?", value: patient.hearingAids || "", copyable: false },
          { label: "Wheelchair / walker?", value: patient.mobilityNeeds || "", copyable: false }
        ]
      }
    ]
  };

  return sheet;
}

function formatCheckInAsText(sheet) {
  let t = "";
  t += "════════════════════════════════════════════\n";
  t += "  " + sheet.title + "\n";
  t += "  " + sheet.instructions + "\n";
  t += "════════════════════════════════════════════\n\n";

  for (const section of sheet.sections) {
    t += "── " + section.title + " ──\n";
    if (section.note) t += "   " + section.note + "\n";
    for (const field of section.fields) {
      if (field.value) {
        t += "   " + field.label + ": " + field.value + "\n";
      }
    }
    if (section.copyAll) {
      t += "   [COPY ALL]:\n   " + section.copyAll.replace(/\n/g, "\n   ") + "\n";
    }
    t += "\n";
  }

  return t;
}

function formatCheckInAsHTML(sheet) {
  let h = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  h += '<title>' + sheet.title + '</title>';
  h += '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;padding:16px;max-width:600px;margin:0 auto}';
  h += '.hdr{text-align:center;padding:20px 0;border-bottom:2px solid #2dd4bf;margin-bottom:20px}.hdr h1{font-size:20px;color:#2dd4bf}.hdr p{color:#94a3b8;font-size:12px;margin-top:4px}';
  h += '.sec{margin-bottom:16px;background:rgba(30,41,59,0.8);border:1px solid rgba(45,212,191,0.12);border-radius:14px;padding:14px}';
  h += '.sec h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#2dd4bf;margin-bottom:10px}';
  h += '.fld{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(51,65,85,0.3);border-radius:10px;margin-bottom:4px;font-size:13px;gap:8px}';
  h += '.fld-label{color:#94a3b8;font-size:11px;flex-shrink:0;max-width:40%}.fld-value{color:#f1f5f9;font-weight:500;text-align:right;word-break:break-all}';
  h += '.copy-btn{background:#2dd4bf;color:#0f172a;border:none;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0}';
  h += '.copy-btn:active{transform:scale(0.95)}.copied{background:#0f766e!important}';
  h += '.note{font-size:12px;color:#fbbf24;padding:6px 10px;background:rgba(251,191,36,0.06);border-radius:8px;margin-bottom:8px}';
  h += '.copy-all{width:100%;padding:10px;background:rgba(45,212,191,0.08);border:1px solid rgba(45,212,191,0.2);border-radius:10px;color:#2dd4bf;font-size:13px;font-weight:600;cursor:pointer;text-align:center;margin-top:6px}';
  h += '.copy-all:active{transform:scale(0.98)}';
  h += '</style></head><body>';

  h += '<div class="hdr"><h1>Check-In Cheat Sheet</h1><p>' + sheet.instructions + '</p></div>';

  for (const section of sheet.sections) {
    if (section.fields.length === 0 && !section.note && !section.copyAll) continue;
    h += '<div class="sec"><h2>' + section.title + '</h2>';
    if (section.note) h += '<div class="note">' + section.note + '</div>';
    for (const field of section.fields) {
      if (!field.value) continue;
      h += '<div class="fld"><span class="fld-label">' + field.label + '</span>';
      h += '<span class="fld-value">' + field.value + '</span>';
      if (field.copyable) {
        h += '<button class="copy-btn" onclick="copyField(this,\'' + escapeForAttr(field.value) + '\')">Copy</button>';
      }
      h += '</div>';
    }
    if (section.copyAll) {
      h += '<button class="copy-all" onclick="copyField(this,\'' + escapeForAttr(section.copyAll) + '\')">Copy Entire List</button>';
    }
    h += '</div>';
  }

  h += '<script>function copyField(btn,text){navigator.clipboard.writeText(text.replace(/\\\\n/g,"\\n")).then(function(){btn.textContent="Copied!";btn.classList.add("copied");setTimeout(function(){btn.textContent=btn.classList.contains("copy-all")?"Copy Entire List":"Copy";btn.classList.remove("copied")},1500)}).catch(function(){var t=document.createElement("textarea");t.value=text.replace(/\\\\n/g,"\\n");document.body.appendChild(t);t.select();document.execCommand("copy");document.body.removeChild(t);btn.textContent="Copied!";setTimeout(function(){btn.textContent=btn.classList.contains("copy-all")?"Copy Entire List":"Copy"},1500)})}</script>';
  h += '</body></html>';
  return h;
}

function escapeForAttr(str) {
  return String(str || "").replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "\\n");
}

function extractCity(address) {
  if (!address) return "";
  const parts = address.split(",");
  return parts.length >= 2 ? parts[parts.length - 2].trim() : "";
}

function extractState(address) {
  if (!address) return "";
  const match = address.match(/\b([A-Z]{2})\b/);
  return match ? match[1] : "";
}

function extractZip(address) {
  if (!address) return "";
  const match = address.match(/\b(\d{5}(-\d{4})?)\b/);
  return match ? match[1] : "";
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

module.exports = { generateCheckInSheet, formatCheckInAsText, formatCheckInAsHTML };
