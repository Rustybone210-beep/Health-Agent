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
const { getPatients, getPatient, updatePatient, addPatient, addDoctor, addVisit } = require("./tools/patients");

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/drafts", express.static("drafts"));
app.use("/calendar", express.static("calendar"));

const upload = multer({ dest: "uploads/", limits: { fileSize: 10*1024*1024 } });
["uploads","drafts","calendar","data"].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d); });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt() {
  const patient = getPatient("maria-fields") || {};
  return `You are Health Agent — an AI healthcare navigator for J Fields managing care for his family in San Antonio, TX.

PATIENT PROFILE (from settings — this is real data entered by the user):
${JSON.stringify(patient, null, 2)}

TRACKED DATA:
- Upcoming Appointments: ${JSON.stringify(listUpcoming())}
- Insurance Claims: ${JSON.stringify(getClaims())}
- Saved Draft Letters: ${JSON.stringify(listDrafts())}

YOUR CAPABILITIES:
1. DOCUMENT ANALYSIS - Read uploaded docs and images. Extract all medical info. Create action plans.
2. IMAGE READING - Read photos of medical documents, prescriptions, insurance cards, lab results.
3. ACTION PLANS - Step-by-step with exact phone scripts.
4. APPEAL LETTERS - Formal insurance appeals with medical necessity arguments.
5. EMAIL DRAFTS - Professional emails to providers and insurance. Auto-saved.
6. APPOINTMENT TRACKING - Track all appointments.
7. INSURANCE TRACKING - Track claims, denials, appeals.
8. MEDICATION MANAGEMENT - Track meds, interactions, pharmacy pricing.
9. DOCTOR RESEARCH - Global specialist search with telehealth and pricing.
10. MEDICAL TRANSLATION - Explain medical terms in plain English.
11. APPOINTMENT PREP - Checklists, questions to ask, prep instructions.
12. CALENDAR EVENTS - Create downloadable calendar files.
13. COST COMPARISON - Compare pharmacy and facility costs.
14. SETTINGS - Users can update patient info at /settings.html

WHEN USER MENTIONS SETTINGS OR ADDING INFO:
Tell them to go to Settings (there's a button in the top bar) to add or update patient information, doctors, insurance details, medications, portal links, etc.

WHEN READING DOCUMENTS:
Read every word. Extract all medical info. Explain in plain language. Create action plan with phone scripts.

WHEN DRAFTING APPEALS:
Formal letter format. Use patient's real insurance info from settings. Cite medical necessity. Reference conditions and history.

RULES:
- NEVER fabricate phone numbers, confirmation numbers, or appointment times
- NEVER pretend to make phone calls
- Use real facility names in San Antonio
- Be honest about what you can and cannot do
- Use **bold** for important info, ## for headers
- Always end with clear next steps
- You are an advocate — fight hard for your patient
- When you write an appeal letter, mention it was auto-saved to drafts`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    const messages = (history || []).concat([{ role: "user", content: message }]);
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 4096,
      system: buildSystemPrompt(), messages: messages,
    });
    const reply = response.content[0].text;
    if (reply.toLowerCase().includes("subject:") && reply.toLowerCase().includes("dear")) {
      const lines = reply.split("\n");
      let subject = "";
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
      const mediaType = mime === "image/jpg" ? "image/jpeg" : mime;
      messages = [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: "Uploaded: \""+req.file.originalname+"\"\n\nRead EVERY word. Extract all medical info. Explain what it means. Create action plan with phone scripts. Flag anything urgent." }
      ]}];
    } else if (mime === "application/pdf") {
      const pdfParse = require("pdf-parse");
      const pdf = await pdfParse(fs.readFileSync(filePath));
      messages = [{ role: "user", content: "Uploaded PDF: \""+req.file.originalname+"\"\n\nContent:\n"+pdf.text+"\n\nAnalyze completely. Create action plan." }];
    } else {
      let text; try { text = fs.readFileSync(filePath,"utf-8").substring(0,5000); } catch(e) { text = "[Could not read]"; }
      messages = [{ role: "user", content: "Uploaded: \""+req.file.originalname+"\"\n\n"+text+"\n\nAnalyze and create action plan." }];
    }
    const response = await client.messages.create({ model: "claude-sonnet-4-20250514", max_tokens: 4096, system: buildSystemPrompt(), messages });
    try { fs.unlinkSync(filePath); } catch(e) {}
    res.json({ reply: response.content[0].text, fileName: req.file.originalname });
  } catch (error) { console.error("Upload error:", error.message); res.status(500).json({ error: error.message }); }
});

// Patient APIs
app.get("/api/patient/:id", (req, res) => { const p = getPatient(req.params.id); res.json(p || {error:"not found"}); });
app.put("/api/patient/:id", (req, res) => { const p = updatePatient(req.params.id, req.body); res.json(p || {error:"not found"}); });
app.post("/api/patient", (req, res) => res.json(addPatient(req.body)));
app.get("/api/patients", (req, res) => res.json(getPatients()));

// Tool APIs
app.post("/api/appointment", (req, res) => res.json(addAppointment(req.body)));
app.get("/api/appointments", (req, res) => res.json(listUpcoming()));
app.post("/api/claim", (req, res) => res.json(addClaim(req.body)));
app.get("/api/claims", (req, res) => res.json(getClaims()));
app.put("/api/claim/:id", (req, res) => res.json(updateClaim(req.params.id,req.body)||{error:"not found"}));
app.post("/api/medication", (req, res) => res.json(addMedication(req.body)));
app.get("/api/medications", (req, res) => res.json(getMedications()));
app.get("/api/drafts", (req, res) => res.json(listDrafts()));
app.post("/api/calendar-event", (req, res) => {
  const { title, description, location, startDate, duration } = req.body;
  res.json(createEvent(title, description||"", location||"", startDate, duration||60));
});
app.get("/api/dashboard", (req, res) => {
  res.json({ patient: getPatient("maria-fields"), appointments: listUpcoming(), claims: getClaims(), medications: getMedications(), drafts: listDrafts() });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/settings", (req, res) => res.sendFile(path.join(__dirname,"public","settings.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Health Agent v6 running at http://localhost:" + PORT));
