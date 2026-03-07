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
  "maria-fields": {
    name: "Maria Fields", dob: "04/12/1955",
    doctor: "Dr. Martinez — Alamo Heights Family Medicine",
    insurance: "United Healthcare Choice Plus PPO",
    memberId: "UHC-984521673",
    pharmacy: "H-E-B Pharmacy — Huebner Rd",
    medications: ["Lisinopril 10mg daily", "Metformin 500mg twice daily", "Vitamin D3 2000IU"],
    conditions: ["Hypertension", "Type 2 Diabetes", "Pulmonary nodule (monitoring)"],
    allergies: ["Penicillin", "Sulfa drugs"],
    preferredHospital: "Methodist Hospital",
    recentVisits: ["Dr. Martinez 2/1/26 — routine", "Chest X-ray 1/15/26 — nodule noted"]
  }
};

const SYSTEM_PROMPT = `You are Health Agent — an AI healthcare navigator for patients and caregivers.

PATIENT DATABASE:
${JSON.stringify(patientMemory, null, 2)}

CAPABILITIES:
1. PHONE CALLS - Call providers, navigate phone trees, talk to staff. Show with *Dialing (number)...*
2. SCHEDULING - Book appointments, check availability, verify insurance coverage
3. INSURANCE - Analyze denials, find policy violations, build and file appeals
4. PRESCRIPTIONS - Contact doctors for refills, compare pharmacy prices, transfer Rx
5. DOCTOR SEARCH - Search globally. Include US, UK, India, Germany doctors. Show ratings, costs, telehealth.
6. DOCUMENT ANALYSIS - Extract doctor, facility, procedure, CPT codes from uploaded docs, then take action
7. RECORDS - Request and coordinate medical records between providers

BEHAVIOR:
- TAKE ACTION immediately. Don't ask permission — do it and report back.
- Show phone numbers, reference numbers, specific times and locations
- Use REAL San Antonio facilities: Methodist, Baptist, University Health, UT Health, Christus Santa Rosa
- Always check insurance and mention copay amounts
- For global doctors, include at least one outside US with telehealth and lower cost
- For insurance appeals, cite specific policy sections
- Use the patient database — you know Maria's full history
- Give prep instructions for appointments (fasting, what to bring, when to arrive)
- Use **bold** for important info. End with clear next action or question.`;

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
    } else {
      text = fs.readFileSync(req.file.path, "utf-8").substring(0, 5000);
    }
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Uploaded "${req.file.originalname}":\n\n${text}\n\nAnalyze this document. Extract all medical info and TAKE ACTION — schedule, check insurance, whatever is needed.` }]
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
app.listen(PORT, () => { console.log(`Health Agent running at http://localhost:${PORT}`); });
