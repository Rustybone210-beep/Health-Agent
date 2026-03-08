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

// Pending extractions waiting for user approval
let pendingUpdates = {};

function buildSystemPrompt() {
  const patient = getPatient("maria-fields") || {};
  return `You are Health Agent — an AI healthcare navigator for J Fields managing care for his mother Linda Fields in San Antonio, TX.

PATIENT PROFILE (verified data):
${JSON.stringify(patient, null, 2)}

TRACKED DATA:
- Upcoming Appointments: ${JSON.stringify(listUpcoming())}
- Insurance Claims: ${JSON.stringify(getClaims())}
- Saved Drafts: ${JSON.stringify(listDrafts())}

CAPABILITIES: Document/image analysis, action plans with phone scripts, appeal letters, appointment tracking, insurance tracking, medication management, global doctor search, medical translation, appointment prep, cost comparison.

CRITICAL RULE FOR DOCUMENT SCANNING:
When you read a document or image, you MUST:
1. Show EXACTLY what you read — every word, every number
2. Present the extracted data clearly
3. DO NOT automatically save anything to the profile
4. Instead, ask the user to CONFIRM the information is correct before saving
5. If anything looks wrong or unclear, flag it and ask the user to verify
6. Format the extracted data so the user can easily review each field

Example response after scanning:
"Here's what I read from this document:
**Name:** Linda Fields
**DOB:** 11/03/1949
**Address:** 123 Main St

**Does this look correct?** Type 'confirm' to save this to the profile, or tell me what needs to be corrected."

NEVER assume data is correct. ALWAYS ask for confirmation. In healthcare, accuracy is everything.

When the user confirms, respond with exactly what was saved.
When the user corrects something, update with their correction and confirm.

OTHER RULES: Never fabricate phone numbers or confirmation numbers. Never pretend to make calls. Use real SA facilities. Be honest. Use **bold** for important info. Always give clear next steps.`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    const lower = message.toLowerCase().trim();

    // Handle confirmations
    if ((lower === 'confirm' || lower === 'yes' || lower === 'save' || lower === 'correct' || lower.includes('confirm')) && Object.keys(pendingUpdates).length > 0) {
      const patient = getPatient("maria-fields") || {};
      const updates = pendingUpdates;
      
      if (updates.name) patient.name = updates.name;
      if (updates.dob) patient.dob = updates.dob;
      if (updates.address) patient.address = updates.address;
      if (updates.insurance) patient.insurance = { ...patient.insurance, ...updates.insurance };
      if (updates.medication) {
        if (!patient.medications) patient.medications = [];
        const exists = patient.medications.find(m => m.name.toLowerCase() === updates.medication.name.toLowerCase());
        if (exists) Object.assign(exists, updates.medication);
        else patient.medications.push(updates.medication);
      }
      if (updates.conditions) {
        patient.conditions = [...new Set([...(patient.conditions || []), ...updates.conditions])];
      }
      if (updates.doctor) {
        if (!patient.doctors) patient.doctors = [];
        const exists = patient.doctors.find(d => d.name === updates.doctor.name);
        if (!exists) patient.doctors.push(updates.doctor);
      }

      updatePatient("maria-fields", patient);
      pendingUpdates = {};
      
      res.json({ reply: "**✅ Profile updated successfully!** All confirmed information has been saved to Linda's profile.\n\nWould you like to scan more documents or do anything else?", profileUpdated: true });
      return;
    }

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
        { type: "text", text: "Read this medical document image carefully. Extract ALL text you can see. Be extremely precise with numbers, dates, and names — read each character carefully.\n\nAfter extracting, present the information clearly and ask me to CONFIRM before saving anything. Format it like:\n\n**Document Type:** [what this is]\n\n**Extracted Information:**\n- Field: Value\n- Field: Value\n\n**⚠️ Please review carefully.** Does everything above look correct? Type 'confirm' to save to the profile, or tell me what needs to be corrected." }
      ]}];
    } else if (mime === "application/pdf") {
      const pdfParse = require("pdf-parse");
      const pdf = await pdfParse(fs.readFileSync(filePath));
      messages = [{ role: "user", content: "PDF content:\n" + pdf.text + "\n\nExtract all information. Present it clearly and ask me to CONFIRM before saving anything to the profile." }];
    } else {
      let text; try { text = fs.readFileSync(filePath,"utf-8").substring(0,5000); } catch(e) { text = "[Could not read]"; }
      messages = [{ role: "user", content: text + "\n\nAnalyze and present findings. Ask for confirmation before saving." }];
    }

    const response = await client.messages.create({ model: "claude-sonnet-4-20250514", max_tokens: 4096, system: buildSystemPrompt(), messages });
    const reply = response.content[0].text;

    // Extract structured data and store as PENDING (not saved yet)
    try {
      const extractResponse = await client.messages.create({
        model: "claude-sonnet-4-20250514", max_tokens: 1024,
        messages: [{ role: "user", content: "From this analysis, extract ONLY the data that was found into JSON. Use these keys where applicable: name, dob, address, insuranceProvider, planName, memberId, groupNumber, insurancePhone, medicationName, dose, frequency, prescriber, pharmacy, rxNumber, conditions, doctorName, facility, procedure. Return ONLY valid JSON.\n\n" + reply }]
      });
      let jsonStr = extractResponse.content[0].text.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
      const extracted = JSON.parse(jsonStr);
      
      // Store as pending — NOT saved to profile yet
      if (extracted.name) pendingUpdates.name = extracted.name;
      if (extracted.dob) pendingUpdates.dob = extracted.dob;
      if (extracted.address) pendingUpdates.address = extracted.address;
      if (extracted.insuranceProvider || extracted.memberId) {
        pendingUpdates.insurance = {};
        if (extracted.insuranceProvider) pendingUpdates.insurance.provider = extracted.insuranceProvider;
        if (extracted.planName) pendingUpdates.insurance.plan = extracted.planName;
        if (extracted.memberId) pendingUpdates.insurance.memberId = extracted.memberId;
        if (extracted.groupNumber) pendingUpdates.insurance.groupNumber = extracted.groupNumber;
        if (extracted.insurancePhone) pendingUpdates.insurance.phone = extracted.insurancePhone;
      }
      if (extracted.medicationName) {
        pendingUpdates.medication = { name: extracted.medicationName, dose: extracted.dose || "", frequency: extracted.frequency || "", prescriber: extracted.prescriber || "", pharmacy: extracted.pharmacy || "", rxNumber: extracted.rxNumber || "" };
      }
      if (extracted.conditions) {
        pendingUpdates.conditions = Array.isArray(extracted.conditions) ? extracted.conditions : [extracted.conditions];
      }
      if (extracted.doctorName) {
        pendingUpdates.doctor = { name: extracted.doctorName, facility: extracted.facility || "", specialty: "", phone: "" };
      }
    } catch(e) { console.log("Extract parse (non-critical):", e.message); }

    try { fs.unlinkSync(filePath); } catch(e) {}
    res.json({ reply, fileName: req.file.originalname, pendingReview: true });
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
app.get("/api/pending", (req, res) => res.json(pendingUpdates));

app.get("/", (req, res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/settings", (req, res) => res.sendFile(path.join(__dirname,"public","settings.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Health Agent v9 running at http://localhost:" + PORT));
