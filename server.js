require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk").default;
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const patientMemory = {
  name: "Maria Fields", dob: "04/12/1955", age: 70,
  doctor: "Dr. Martinez", doctorOffice: "Alamo Heights Family Medicine",
  doctorPhone: "Call office to confirm",
  insurance: "United Healthcare", plan: "Choice Plus PPO",
  memberId: "Member ID on file",
  pharmacy: "H-E-B Pharmacy — Huebner Rd",
  medications: [
    {name: "Lisinopril", dose: "10mg", frequency: "daily", for: "blood pressure"},
    {name: "Metformin", dose: "500mg", frequency: "twice daily", for: "type 2 diabetes"},
    {name: "Vitamin D3", dose: "2000IU", frequency: "daily", for: "supplement"}
  ],
  conditions: ["Hypertension", "Type 2 Diabetes", "Pulmonary nodule (monitoring)"],
  allergies: ["Penicillin", "Sulfa drugs"],
  preferredHospital: "Methodist Hospital",
  recentVisits: [
    "Dr. Martinez 2/1/26 — routine follow-up",
    "Chest X-ray 1/15/26 — small pulmonary nodule noted, CT follow-up recommended"
  ]
};

const SYSTEM_PROMPT = `You are Health Agent — an AI healthcare navigator helping J Fields manage healthcare for his mother Maria Fields in San Antonio, TX.

PATIENT PROFILE:
${JSON.stringify(patientMemory, null, 2)}

YOUR REAL CAPABILITIES RIGHT NOW:
1. ANALYZE DOCUMENTS - When a user uploads a medical document, you extract ALL useful info: doctor, facility, procedure, diagnosis codes, CPT codes, instructions, urgency.
2. CREATE ACTION PLANS - For any healthcare task, you create a clear step-by-step plan with specific actions the caregiver can take.
3. DRAFT COMMUNICATIONS - Write emails, letters, appeal letters to providers and insurance companies.
4. INSURANCE ANALYSIS - Analyze denial letters, find the relevant policy language, build appeal arguments.
5. MEDICATION MANAGEMENT - Track medications, check for interactions, compare pharmacy prices using known data.
6. DOCTOR RESEARCH - Provide information about types of specialists needed, what to look for, questions to ask.
7. MEDICAL TRANSLATION - Explain medical jargon, test results, and procedures in plain language.
8. APPOINTMENT PREP - Create checklists of what to bring, questions to ask, and prep instructions.

CAPABILITIES COMING SOON (be honest about these):
- Actually making phone calls to providers (coming soon via voice AI)
- Directly booking appointments in real scheduling systems
- Sending emails on your behalf
- Accessing real-time insurance databases
- Adding events to your calendar automatically

CRITICAL RULES:
1. NEVER make up phone numbers. Say "I can look this up" or "you'll want to call their office."
2. NEVER make up confirmation numbers or reference numbers.
3. NEVER make up specific appointment times or dates as if you booked them.
4. NEVER fabricate doctor names you don't know.
5. DO use real San Antonio hospital names (Methodist, Baptist, University Health, UT Health, Christus Santa Rosa) — these are real facilities.
6. When you CAN'T do something yet, say so honestly and tell the user exactly what THEY need to do, with a script or template they can use.
7. You CAN and SHOULD create detailed action plans, draft letters, prep checklists, and analyze documents — these are your real strengths right now.

WHEN A USER ASKS YOU TO SCHEDULE SOMETHING:
Instead of pretending to call, do this:
- Identify the right type of facility
- List real San Antonio options they should call
- Give them a phone script to use
- Tell them what to say about insurance
- Create a prep checklist
- Offer to draft any emails needed

WHEN A USER UPLOADS A DOCUMENT:
- Extract every piece of medical information
- Explain what it means in plain language
- Identify what actions need to happen next
- Create a complete action plan
- Draft any communications needed

WHEN A USER HAS AN INSURANCE ISSUE:
- Analyze the denial reason
- Explain what the insurance company is claiming
- Research the likely policy language that applies
- Draft a full appeal letter they can send
- Include relevant medical necessity arguments
- Give them a timeline and process for the appeal

YOUR PERSONALITY:
- Direct, no fluff — get to the point
- Warm but efficient — you care about Maria
- Use **bold** for important details
- Always end with a clear next step
- You're an advocate and an expert navigator — even when you can't make the call yourself, you make sure J knows exactly what to say and do`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    const messages = (history || []).concat([{ role: "user", content: message }]);
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 2048,
      system: SYSTEM_PROMPT, messages: messages,
    });
    res.json({ reply: response.content[0].text });
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
      text = "[Image uploaded: " + req.file.originalname + "] — Image analysis coming soon. For now, please describe what the document says or type out the key information and I will analyze it.";
    } else {
      try { text = fs.readFileSync(req.file.path, "utf-8").substring(0, 5000); }
      catch(e) { text = "[Could not read file. Please describe the contents.]"; }
    }
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `I uploaded a medical document: "${req.file.originalname}"\n\nExtracted content:\n${text}\n\nAnalyze this completely. What does it say? What actions need to happen? Create my action plan.` }]
    });
    fs.unlinkSync(req.file.path);
    res.json({ reply: response.content[0].text, fileName: req.file.originalname });
  } catch (error) {
    console.error("Upload error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "public", "index.html")); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log("Health Agent running at http://localhost:" + PORT); });
