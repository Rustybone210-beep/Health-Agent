const fs = require("fs");
const path = require("path");

const draftsDir = path.join(__dirname, "..", "drafts");
if (!fs.existsSync(draftsDir)) fs.mkdirSync(draftsDir);

function saveDraft(to, subject, body) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `draft-${timestamp}.txt`;
  const content = `TO: ${to}\nSUBJECT: ${subject}\nDATE: ${new Date().toLocaleString()}\n\n${body}`;
  fs.writeFileSync(path.join(draftsDir, fileName), content);
  return { fileName, path: path.join(draftsDir, fileName) };
}

function listDrafts() {
  if (!fs.existsSync(draftsDir)) return [];
  return fs.readdirSync(draftsDir).filter(f => f.endsWith(".txt")).map(f => {
    const content = fs.readFileSync(path.join(draftsDir, f), "utf-8");
    const lines = content.split("\n");
    return { fileName: f, to: lines[0].replace("TO: ", ""), subject: lines[1].replace("SUBJECT: ", "") };
  });
}



// === REAL EMAIL SENDING WITH RESEND ===
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendRealEmail(to, subject, htmlBody) {
  if (!resend) {
    console.log('⚠️  Resend not configured — email not sent to', to);
    return { success: false, error: 'Email not configured' };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'Health Agent <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: htmlBody,
    });

    if (error) throw error;
    console.log(`✅ Email sent to ${to} | Message ID: ${data.id}`);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error("❌ Email send failed:", error);
    throw error;
  }
}

module.exports = { saveDraft, listDrafts, sendRealEmail };