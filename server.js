require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk").default;
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const { saveDraft, listDrafts } = require("./tools/email");
const { createEvent } = require("./tools/calendar");
const { getAppointments, addAppointment, listUpcoming } = require("./tools/appointments");
const { getClaims, addClaim, updateClaim } = require("./tools/insurance");
const { getMedications, addMedication } = require("./tools/medications");
const { getPatients, getPatient, updatePatient, addPatient } = require("./tools/patients");

const app = express();
app.use(express.json({limit:'10mb'}));
app.use(express.static("public"));
app.use("/drafts", express.static("drafts"));
app.use("/calendar", express.static("calendar"));

const upload = multer({ dest: "uploads/", limits: { fileSize: 10*1024*1024 } });
["uploads","drafts","calendar","data"].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d); });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt() {
  const patient = getPatient("maria-fields") || {};
  return `You are Health Agent — an AI healthcare navigator for J Fields managing care for his family in San Antonio, TX.

PATIENT PROFILE:
${JSON.stringify(patient, null, 2)}

TRACKED DATA:
- Upcoming Appointments: ${JSON.stringify(listUpcoming())}
- Insurance Claims: ${JSON.stringify(getClaims())}
- Saved Drafts: ${JSON.stringify(listDrafts())}

CAPABILITIES:
1. DOCUMENT/IMAGE ANALYSIS - Read any uploaded medical document or photo. Auto-detect what it is and extract all info.
2. SMART PROFILE UPDATES - When you identify info from a scanned document (insurance details, medications, doctor info), tell the user exactly what you found and that you are updating their profile.
3. ACTION PLANS - Step-by-step with exact phone scripts.
4. APPEAL LETTERS - Formal insurance appeals with medical necessity arguments. Auto-saved to drafts.
5. APPOINTMENT TRACKING - Track all appointments.
6. INSURANCE TRACKING - Track claims, denials, appeals.
7. MEDICATION MANAGEMENT - Track meds, interactions, pharmacy pricing.
8. DOCTOR RESEARCH - Global specialist search with telehealth and pricing.
9. MEDICAL TRANSLATION - Explain medical terms in plain English.
10. APPOINTMENT PREP - Checklists and questions to ask.
11. COST COMPARISON - Compare pharmacy and facility costs.

WHEN YOU RECEIVE AN IMAGE, auto-detect what type of document it is:
- Insurance card → extract provider, plan, member ID, group number, copays, phone
- ID/drivers license → extract name, DOB, address
- Prescription bottle → extract medication name, dose, frequency, prescriber, pharmacy, Rx number
- Medical record/lab result → extract conditions, doctor, diagnoses, results, instructions
- Bill/EOB → extract charges, insurance paid, patient owes, claim number
- Doctor order/referral → extract procedure ordered, referring doctor, diagnosis codes, CPT codes, urgency
- Any other medical document → read everything and summarize

After identifying the document type, respond with:
1. What type of document you detected
2. ALL information you extracted (formatted clearly)
3. What you are saving to the patient profile
4. Any action items or next steps based on this document
5. Offer to help with whatever the document relates to

RULES: Never fabricate data. Be honest about capabilities. Use **bold** for important info. Always give clear next steps.`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    const messages = (history || []).concat([{ role: "user", content: message }]);
    const response = await client.messages.create({ model: "claude-sonnet-4-20250514", max_tokens: 4096, system: buildSystemPrompt(), messages });
    const reply = response.content[0].text;
    if (reply.toLowerCase().includes("subject:") && reply.toLowerCase().includes("dear")) {
      const lines = reply.split("\n"); let subject = "";
      for (const l of lines) { if (l.toLowerCase().startsWith("subject:")) subject = l.replace(/subject:\s*/i,""); }
      if (subject) { const start = reply.indexOf("Dear"); if (start > 0) saveDraft("provider", subject, reply.substring(start)); }
    }
    res.json({ reply });
  } catch (error) { console.error("Chat error:", error.message); res.status(500).json({ error: error.message }); }
});

app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const mime = req.file.mimetype, filePath = req.file.path;
    let messages = [];

    if (mime.startsWith("image/")) {
      const base64 = fs.readFileSync(filePath).toString("base64");
      messages = [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime === "image/jpg" ? "image/jpeg" : mime, data: base64 } },
        { type: "text", text: "I just uploaded this image. Auto-detect what type of medical document this is. Read EVERY word visible. Extract ALL information. Tell me what you found, what you are saving to my profile, and what actions I should take next. If this is an insurance card, medication bottle, ID, medical record, bill, or order — handle it appropriately." }
      ]}];
    } else if (mime === "application/pdf") {
      const pdfParse = require("pdf-parse");
      const pdf = await pdfParse(fs.readFileSync(filePath));
      messages = [{ role: "user", content: "Uploaded PDF:\n" + pdf.text + "\n\nAuto-detect document type. Extract all info. Tell me what to save and what actions to take." }];
    } else {
      let text; try { text = fs.readFileSync(filePath,"utf-8").substring(0,5000); } catch(e) { text = "[Could not read]"; }
      messages = [{ role: "user", content: text + "\n\nAnalyze and create action plan." }];
    }

    const response = await client.messages.create({ model: "claude-sonnet-4-20250514", max_tokens: 4096, system: buildSystemPrompt(), messages });
    const reply = response.content[0].text;

    // Auto-extract structured data for profile updates
    try {
      const extractResponse = await client.messages.create({
        model: "claude-sonnet-4-20250514", max_tokens: 1024,
        messages: [{ role: "user", content: "Based on this analysis, extract ONLY the structured data as JSON. Include only fields that were found. Use these possible keys: documentType, patientName, dob, address, insuranceProvider, planName, memberId, groupNumber, insurancePhone, copays, medicationName, dose, frequency, prescriber, pharmacy, rxNumber, conditions, doctorName, facility, procedure, diagnosisCode, cptCode. Return ONLY valid JSON.\n\nAnalysis:\n" + reply }]
      });
      let jsonStr = extractResponse.content[0].text.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
      const extracted = JSON.parse(jsonStr);

      // Auto-update patient profile
      let patient = getPatient("maria-fields") || {};
      if (extracted.patientName) patient.name = extracted.patientName;
      if (extracted.dob) patient.dob = extracted.dob;
      if (extracted.address) patient.address = extracted.address;
      if (extracted.insuranceProvider || extracted.memberId) {
        if (!patient.insurance) patient.insurance = {};
        if (extracted.insuranceProvider) patient.insurance.provider = extracted.insuranceProvider;
        if (extracted.planName) patient.insurance.plan = extracted.planName;
        if (extracted.memberId) patient.insurance.memberId = extracted.memberId;
        if (extracted.groupNumber) patient.insurance.groupNumber = extracted.groupNumber;
        if (extracted.insurancePhone) patient.insurance.phone = extracted.insurancePhone;
        if (extracted.copays) patient.insurance.copay = extracted.copays;
      }
      if (extracted.medicationName) {
        const newMed = { name: extracted.medicationName, dose: extracted.dose || "", frequency: extracted.frequency || "", prescriber: extracted.prescriber || "", pharmacy: extracted.pharmacy || "", rxNumber: extracted.rxNumber || "" };
        if (!patient.medications) patient.medications = [];
        const exists = patient.medications.find(m => m.name.toLowerCase() === newMed.name.toLowerCase());
        if (!exists) patient.medications.push(newMed);
        else Object.assign(exists, newMed);
      }
      if (extracted.conditions) {
        const newConditions = Array.isArray(extracted.conditions) ? extracted.conditions : [extracted.conditions];
        patient.conditions = [...new Set([...(patient.conditions || []), ...newConditions])];
      }
      if (extracted.doctorName) {
        if (!patient.doctors) patient.doctors = [];
        const exists = patient.doctors.find(d => d.name === extracted.doctorName);
        if (!exists) patient.doctors.push({ name: extracted.doctorName, facility: extracted.facility || "", specialty: "", phone: "" });
      }
      updatePatient("maria-fields", patient);
    } catch(e) { console.log("Auto-extract parse error (non-critical):", e.message); }

    try { fs.unlinkSync(filePath); } catch(e) {}
    res.json({ reply, fileName: req.file.originalname });
  } catch (error) { console.error("Upload error:", error.message); res.status(500).json({ error: error.message }); }
});

app.get("/api/patient/:id", (req, res) => res.json(getPatient(req.params.id) || {error:"not found"}));
app.put("/api/patient/:id", (req, res) => res.json(updatePatient(req.params.id, req.body) || {error:"not found"}));
app.post("/api/patient", (req, res) => res.json(addPatient(req.body)));
app.post("/api/appointment", (req, res) => res.json(addAppointment(req.body)));
app.get("/api/appointments", (req, res) => res.json(listUpcoming()));
app.post("/api/claim", (req, res) => res.json(addClaim(req.body)));
app.get("/api/claims", (req, res) => res.json(getClaims()));
app.get("/api/drafts", (req, res) => res.json(listDrafts()));
app.get("/api/dashboard", (req, res) => {
  res.json({ patient: getPatient("maria-fields"), appointments: listUpcoming(), claims: getClaims(), medications: getMedications(), drafts: listDrafts() });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/settings", (req, res) => res.sendFile(path.join(__dirname,"public","settings.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Health Agent v8 running at http://localhost:" + PORT));
