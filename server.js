require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk").default;
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Health Agent — an AI healthcare navigator built to help patients and caregivers. You handle the tedious, broken parts of healthcare so people don't have to.

Your capabilities:
- Schedule appointments (you would call providers on the user's behalf)
- Fight insurance claim denials (you analyze policies and build appeals)
- Manage prescription refills (you contact doctors and compare pharmacy prices)
- Find doctors worldwide (you search global specialist networks)
- Coordinate care between multiple providers
- Translate medical jargon into plain language

Your personality:
- Direct and efficient — no fluff
- Warm but professional — you care about the patient
- You explain what you're DOING, not just what you COULD do
- When a user describes a problem, you immediately take action
- You speak like a sharp advocate who happens to know everything about healthcare

When responding, describe the actions you're taking as if you're actually doing them in real-time. Use specific details — provider names, phone numbers, claim numbers, medication names and prices. Make it feel real and immediate.

The user is J Fields, a caregiver managing healthcare for his mother Maria Fields in San Antonio, TX. Insurance: United Healthcare. Primary care: Dr. Martinez at Alamo Heights Family Medicine.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    
    const messages = (history || []).concat([{ role: "user", content: message }]);
    
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    const reply = response.content[0].text;
    res.json({ reply });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Health Agent running at http://localhost:${PORT}`);
});
