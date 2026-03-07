require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk").default;
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const { saveDraft, listDrafts } = require("./tools/email");
const { createEvent, listEvents } = require("./tools/calendar");
const { getAppointments, addAppointment, listUpcoming } = require("./tools/appointments");
const { getClaims, addClaim, updateClaim } = require("./tools/insurance");
const { getMedications, addMedication } = require("./tools/medications");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const patientMemory = {
  name: "Maria Fields", dob: "04/12/1955", age: 70,
  doctor: "Dr. Martinez", doctorOffice: "Alamo Heights Family Medicine",
  insurance: "United Healthcare", plan: "Choice Plus PPO",
  pharmacy: "H-E-B Pharmacy — Huebner Rd",
  medications: [
    {name:"Lisinopril",dose:"10mg",frequency:"daily",for:"blood pressure"},
    {name:"Metformin",dose:"500mg",frequency:"twice daily",for:"type 2 diabetes"},
    {name:"Vitamin D3",dose:"2000IU",frequency:"daily",for:"supplement"}
  ],
  conditions: ["Hypertension","Type 2 Diabetes","Pulmonary nodule (monitoring)"],
  allergies: ["Penicillin","Sulfa drugs"],
  preferredHospital: "Methodist Hospital",
  recentVisits: ["Dr. Martinez 2/1/26 — routine","Chest X-ray 1/15/26 — pulmonary nodule noted"]
};

const SYSTEM_PROMPT = `You are Health Agent — an AI healthcare navigator for J Fields managing care for his mother Maria Fields in San Antonio, TX.

PATIENT PROFILE:
${JSON.stringify(patientMemory, null, 2)}

CURRENT APPOINTMENTS: ${JSON.stringify(listUpcoming())}
CURRENT CLAIMS: ${JSON.stringify(getClaims())}
CURRENT MEDICATIONS ON FILE: ${JSON.stringify(getMedications())}
SAVED DRAFTS: ${JSON.stringify(listDrafts())}

YOUR CAPABILITIES:
1. DOCUMENT ANALYSIS - Extract all medical info from uploaded documents and create action plans
2. ACTION PLANS - Step-by-step plans with phone scripts for any healthcare task
3. APPEAL LETTERS - Draft full insurance appeal letters with medical necessity arguments
4. EMAIL DRAFTS - Draft emails to providers, insurance, pharmacies. Tell user "I've saved a draft email" when you create one.
5. APPOINTMENT TRACKING - Track scheduled and upcoming appointments
6. INSURANCE TRACKING - Track claims, denials, and appeal status
7. MEDICATION MANAGEMENT - Track meds, check interactions, compare prices
8. DOCTOR RESEARCH - Research specialists, suggest questions to ask
9. MEDICAL TRANSLATION - Explain medical jargon in plain language
10. APPOINTMENT PREP - Checklists for what to bring and questions to ask
11. CALENDAR EVENTS - Create downloadable calendar events for appointments

WHEN CREATING ACTION PLANS:
- Give exact phone scripts in quotes that J can read word-for-word
- List real San Antonio facilities (Methodist, Baptist, University Health, UT Health, Christus Santa Rosa)
- Always mention insurance verification steps
- Include prep checklists

WHEN DRAFTING APPEAL LETTERS:
- Use formal business letter format
- Cite relevant medical policy language
- Include patient history supporting medical necessity
- Reference specific diagnosis and procedure codes when known
- Include timeline for response

RULES:
- NEVER make up phone numbers, confirmation numbers, or specific appointment times
- NEVER pretend you made a phone call
- Be honest about what you can and cannot do
- Use **bold** for important details
- Always end with clear next steps
- You are an advocate — fight hard for your patient`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    const messages = (history || []).concat([{ role: "user", content: message }]);
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 2048,
      system: SYSTEM_PROMPT, messages: messages,
    });
    const reply = response.content[0].text;

    // Auto-detect if agent drafted an email and save it
    if (reply.toLowerCase().includes("subject:") && reply.toLowerCase().includes("dear")) {
      const lines = reply.split("\n");
      let subject = "", body = "";
      for (const line of lines) {
        if (line.toLowerCase().startsWith("subject:")) subject = line.replace(/subject:\s*/i, "");
      }
      if (subject) {
        const emailStart = reply.indexOf("Dear");
        if (emailStart > 0) body = reply.substring(emailStart);
        if (body) saveDraft("provider", subject, body);
      }
    }

    res.json({ reply });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });
    let text = "";
    if (req.file.mimetype === "application/pdf") {
      const pdfParse = require("pdf-parse");
      const buf = fs.readFileSync(req.file.path);
      const pdf = await pdfParse(buf);
      text = pdf.text;
    } else if (req.file.mimetype.startsWith("image/")) {
      text = "[Image: " + req.file.originalname + "] Please describe what this document says so I can analyze it.";
    } else {
      try { text = fs.readFileSync(req.file.path, "utf-8").substring(0, 5000); }
      catch(e) { text = "[Could not read. Please describe the contents.]"; }
    }
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 2048, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: "Uploaded: \"" + req.file.originalname + "\"\n\nContent:\n" + text + "\n\nAnalyze completely. Extract all medical info. Create action plan." }]
    });
    fs.unlinkSync(req.file.path);
    res.json({ reply: response.content[0].text, fileName: req.file.originalname });
  } catch (error) {
    console.error("Upload error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// API endpoints for tools
app.post("/api/appointment", (req, res) => {
  const appt = addAppointment(req.body);
  res.json(appt);
});
app.get("/api/appointments", (req, res) => res.json(listUpcoming()));

app.post("/api/claim", (req, res) => {
  const claim = addClaim(req.body);
  res.json(claim);
});
app.get("/api/claims", (req, res) => res.json(getClaims()));

app.get("/api/drafts", (req, res) => res.json(listDrafts()));

app.post("/api/calendar-event", (req, res) => {
  const { title, description, location, startDate, duration } = req.body;
  const event = createEvent(title, description, location, startDate, duration || 60);
  res.json(event);
});

app.get("/api/dashboard", (req, res) => {
  res.json({
    patient: patientMemory,
    appointments: listUpcoming(),
    claims: getClaims(),
    medications: getMedications(),
    drafts: listDrafts()
  });
});

app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "public", "index.html")); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log("Health Agent running at http://localhost:" + PORT); });
