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

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/drafts", express.static("drafts"));
app.use("/calendar", express.static("calendar"));

const upload = multer({ dest: "uploads/", limits: { fileSize: 10 * 1024 * 1024 } });
["uploads","drafts","calendar","data"].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d); });

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

function buildSystemPrompt() {
  return `You are Health Agent — an AI healthcare navigator for J Fields managing care for his mother Maria Fields in San Antonio, TX.

PATIENT PROFILE:
${JSON.stringify(patientMemory, null, 2)}

TRACKED DATA:
- Upcoming Appointments: ${JSON.stringify(listUpcoming())}
- Insurance Claims: ${JSON.stringify(getClaims())}
- Medications on File: ${JSON.stringify(getMedications())}
- Saved Draft Letters: ${JSON.stringify(listDrafts())}

YOUR CAPABILITIES:
1. DOCUMENT ANALYSIS - Read uploaded documents including photos of medical orders, prescriptions, insurance cards, denial letters, lab results. Extract ALL information and create action plans.
2. IMAGE READING - You can see and read images. When a user uploads a photo of a document, read every word and analyze it.
3. ACTION PLANS - Step-by-step plans with exact phone scripts the caregiver can read word-for-word.
4. APPEAL LETTERS - Draft formal insurance appeal letters with medical necessity arguments, policy citations, and supporting evidence.
5. EMAIL DRAFTS - Draft professional emails to providers, insurance companies, pharmacies. These are auto-saved.
6. APPOINTMENT TRACKING - Track all scheduled and upcoming appointments.
7. INSURANCE TRACKING - Track claims, denials, appeal status, deadlines.
8. MEDICATION MANAGEMENT - Track medications, check for interactions, compare pharmacy pricing.
9. DOCTOR RESEARCH - Research specialists globally. Include US and international options with telehealth and pricing.
10. MEDICAL TRANSLATION - Explain medical terms, lab results, procedures in plain English.
11. APPOINTMENT PREP - Create checklists: what to bring, questions to ask, prep instructions.
12. CALENDAR EVENTS - Create downloadable calendar events.
13. COST COMPARISON - Compare costs across pharmacies, facilities, and providers.
14. REFERRAL MANAGEMENT - Track referrals and ensure they get processed.

WHEN READING UPLOADED DOCUMENTS:
- Read EVERY word visible in the document or image
- Extract: patient name, doctor name, facility, procedure ordered, diagnosis codes (ICD-10), procedure codes (CPT), medications, dosages, dates, instructions
- Explain what the document means in plain language
- Identify what actions need to happen based on this document
- Create a complete action plan with phone scripts
- Flag anything urgent or time-sensitive

WHEN CREATING APPEAL LETTERS:
- Formal business letter format
- Include patient demographics (from profile)
- State the denied service and claim info
- Argue medical necessity with specific clinical reasons
- Reference Maria's conditions and medical history
- Cite relevant clinical guidelines
- Request expedited review if time-sensitive
- Include deadline for response

WHEN COMPARING COSTS:
- Use known San Antonio pharmacy pricing ranges
- Mention GoodRx, Cost Plus Drugs (Mark Cuban), manufacturer coupons
- Compare at least 3 options when possible

FORMATTING:
- Use **bold** for important information
- Use ## headers for sections
- Use numbered steps for action plans
- Use bullet points for lists
- Use *italics* for phone scripts the user should read aloud

RULES:
- NEVER fabricate phone numbers, confirmation numbers, or appointment times
- NEVER pretend you made a phone call
- Be honest about capabilities — say what you can and cannot do
- Always end with clear next steps
- Fight hard for your patient — you are their advocate
- When you draft a letter, mention that it has been saved automatically`;
}

// Main chat
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
      if (subject) {
        const start = reply.indexOf("Dear");
        if (start > 0) saveDraft("provider", subject, reply.substring(start));
      }
    }
    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Document + image upload
app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    const mime = req.file.mimetype;
    const filePath = req.file.path;
    let messages = [];

    if (mime.startsWith("image/")) {
      const imageData = fs.readFileSync(filePath);
      const base64 = imageData.toString("base64");
      const mediaType = mime === "image/jpg" ? "image/jpeg" : mime;
      messages = [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "I uploaded this medical document image: \"" + req.file.originalname + "\"\n\nRead EVERY word in this image. Extract all medical information: patient name, doctor, facility, procedure, diagnosis codes, CPT codes, medications, dates, instructions.\n\nThen:\n1. Explain what this document is and what it means\n2. Identify what actions need to happen\n3. Create a complete action plan with phone scripts\n4. Flag anything urgent" }
        ]
      }];
    } else if (mime === "application/pdf") {
      const pdfParse = require("pdf-parse");
      const buf = fs.readFileSync(filePath);
      const pdf = await pdfParse(buf);
      messages = [{
        role: "user",
        content: "Uploaded PDF: \"" + req.file.originalname + "\"\n\nContent:\n" + pdf.text + "\n\nRead everything. Extract all medical info. Explain what it means. Create action plan."
      }];
    } else {
      let text;
      try { text = fs.readFileSync(filePath, "utf-8").substring(0, 5000); }
      catch(e) { text = "[Could not read file]"; }
      messages = [{
        role: "user",
        content: "Uploaded: \"" + req.file.originalname + "\"\n\nContent:\n" + text + "\n\nAnalyze and create action plan."
      }];
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 4096,
      system: buildSystemPrompt(), messages: messages,
    });

    try { fs.unlinkSync(filePath); } catch(e) {}
    res.json({ reply: response.content[0].text, fileName: req.file.originalname });
  } catch (error) {
    console.error("Upload error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Tool APIs
app.post("/api/appointment", (req, res) => res.json(addAppointment(req.body)));
app.get("/api/appointments", (req, res) => res.json(listUpcoming()));
app.post("/api/claim", (req, res) => res.json(addClaim(req.body)));
app.get("/api/claims", (req, res) => res.json(getClaims()));
app.put("/api/claim/:id", (req, res) => { const c = updateClaim(req.params.id, req.body); res.json(c || {error:"not found"}); });
app.post("/api/medication", (req, res) => res.json(addMedication(req.body)));
app.get("/api/medications", (req, res) => res.json(getMedications()));
app.get("/api/drafts", (req, res) => res.json(listDrafts()));
app.post("/api/calendar-event", (req, res) => {
  const { title, description, location, startDate, duration } = req.body;
  res.json(createEvent(title, description || "", location || "", startDate, duration || 60));
});
app.get("/api/dashboard", (req, res) => {
  res.json({ patient: patientMemory, appointments: listUpcoming(), claims: getClaims(), medications: getMedications(), drafts: listDrafts() });
});

app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "public", "index.html")); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log("Health Agent v5 running at http://localhost:" + PORT); });
