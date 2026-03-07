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

module.exports = { saveDraft, listDrafts };
