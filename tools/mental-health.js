const fs = require("fs");
const path = require("path");
const SCREENING_FILE = path.join(__dirname, "..", "data", "mental_health_screenings.json");

const PHQ9 = {
  name: "PHQ-9 Depression Screening",
  description: "Patient Health Questionnaire — screens for depression severity",
  questions: [
    "Little interest or pleasure in doing things",
    "Feeling down, depressed, or hopeless",
    "Trouble falling or staying asleep, or sleeping too much",
    "Feeling tired or having little energy",
    "Poor appetite or overeating",
    "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
    "Trouble concentrating on things, such as reading or watching television",
    "Moving or speaking so slowly that other people could have noticed, or being so fidgety or restless",
    "Thoughts that you would be better off dead, or of hurting yourself"
  ],
  options: [
    { value: 0, label: "Not at all" },
    { value: 1, label: "Several days" },
    { value: 2, label: "More than half the days" },
    { value: 3, label: "Nearly every day" }
  ],
  scoring: (total) => {
    if (total <= 4) return { severity: "minimal", recommendation: "No treatment needed. Monitor if symptoms persist." };
    if (total <= 9) return { severity: "mild", recommendation: "Watchful waiting. Repeat screening in 2 weeks. Consider counseling." };
    if (total <= 14) return { severity: "moderate", recommendation: "Consider counseling and/or medication. Discuss with primary care doctor." };
    if (total <= 19) return { severity: "moderately severe", recommendation: "Active treatment recommended — therapy plus medication. Discuss with doctor promptly." };
    return { severity: "severe", recommendation: "Immediate treatment needed. Contact healthcare provider today. If having thoughts of self-harm, call 988 Suicide & Crisis Lifeline." };
  }
};

const GAD7 = {
  name: "GAD-7 Anxiety Screening",
  description: "Generalized Anxiety Disorder screener",
  questions: [
    "Feeling nervous, anxious, or on edge",
    "Not being able to stop or control worrying",
    "Worrying too much about different things",
    "Trouble relaxing",
    "Being so restless that it's hard to sit still",
    "Becoming easily annoyed or irritable",
    "Feeling afraid, as if something awful might happen"
  ],
  options: [
    { value: 0, label: "Not at all" },
    { value: 1, label: "Several days" },
    { value: 2, label: "More than half the days" },
    { value: 3, label: "Nearly every day" }
  ],
  scoring: (total) => {
    if (total <= 4) return { severity: "minimal", recommendation: "No treatment needed at this time." };
    if (total <= 9) return { severity: "mild", recommendation: "Monitor symptoms. Consider stress-reduction techniques." };
    if (total <= 14) return { severity: "moderate", recommendation: "Consider counseling. Discuss with doctor if symptoms impact daily life." };
    return { severity: "severe", recommendation: "Active treatment recommended. Contact healthcare provider. Consider therapy and medication." };
  }
};

const CAREGIVER_BURNOUT = {
  name: "Caregiver Burnout Assessment",
  description: "Screens for caregiver stress and burnout",
  questions: [
    "I feel exhausted when I get up in the morning and have another day ahead of me",
    "I feel like I am at the end of my rope",
    "I feel I am being asked to do more than is fair",
    "I feel resentful toward the person I care for",
    "I feel my health has suffered because of caregiving",
    "I don't have enough privacy",
    "I feel my social life has suffered",
    "I feel I have lost control of my life since caregiving began",
    "I feel uncertain about what to do about the person I care for",
    "I feel I should be doing more for the person I care for"
  ],
  options: [
    { value: 0, label: "Never" },
    { value: 1, label: "Rarely" },
    { value: 2, label: "Sometimes" },
    { value: 3, label: "Quite frequently" },
    { value: 4, label: "Nearly always" }
  ],
  scoring: (total) => {
    if (total <= 10) return { severity: "low", recommendation: "You're managing well. Continue self-care routines." };
    if (total <= 20) return { severity: "mild", recommendation: "Some stress detected. Consider respite care, support groups, or help from family." };
    if (total <= 30) return { severity: "moderate", recommendation: "Significant caregiver stress. Seek support — respite care, counseling, local caregiver resources. Your health matters too." };
    return { severity: "high", recommendation: "High burnout risk. Please prioritize your own health. Consider professional counseling, respite care, and delegating tasks. You cannot care for others if you don't care for yourself." };
  }
};

const SCREENINGS = { phq9: PHQ9, gad7: GAD7, caregiver_burnout: CAREGIVER_BURNOUT };

function getScreening(type) {
  return SCREENINGS[type] || null;
}

function scoreScreening(type, answers) {
  const screening = SCREENINGS[type];
  if (!screening) throw new Error("Unknown screening type: " + type);
  if (!Array.isArray(answers)) throw new Error("Answers must be an array of numbers");
  const total = answers.reduce((sum, a) => sum + (parseInt(a) || 0), 0);
  const maxScore = screening.questions.length * (screening.options[screening.options.length - 1].value);
  const result = screening.scoring(total);
  return {
    screening: type,
    name: screening.name,
    totalScore: total,
    maxScore,
    percentage: Math.round((total / maxScore) * 100),
    ...result,
    completedAt: new Date().toISOString()
  };
}

function saveScreeningResult(patientId, userId, result) {
  let all = [];
  try {
    if (fs.existsSync(SCREENING_FILE)) all = JSON.parse(fs.readFileSync(SCREENING_FILE, "utf8"));
  } catch (e) { all = []; }
  all.push({
    id: Date.now().toString(),
    patientId,
    userId: userId || null,
    ...result
  });
  fs.writeFileSync(SCREENING_FILE, JSON.stringify(all.slice(-200), null, 2));
  return result;
}

function getScreeningHistory(patientId, type) {
  try {
    if (!fs.existsSync(SCREENING_FILE)) return [];
    const all = JSON.parse(fs.readFileSync(SCREENING_FILE, "utf8"));
    let filtered = all.filter(s => s.patientId === patientId);
    if (type) filtered = filtered.filter(s => s.screening === type);
    return filtered.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  } catch (e) { return []; }
}

function getAvailableScreenings() {
  return Object.entries(SCREENINGS).map(([key, s]) => ({
    id: key,
    name: s.name,
    description: s.description,
    questionCount: s.questions.length
  }));
}

module.exports = { getScreening, scoreScreening, saveScreeningResult, getScreeningHistory, getAvailableScreenings, SCREENINGS };
