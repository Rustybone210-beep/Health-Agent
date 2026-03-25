const fs = require("fs");
const path = require("path");

function generateSmartPrep(patient, appointment, recentData) {
  const prep = {
    appointment: {
      doctor: appointment.doctorName || "",
      specialty: appointment.specialty || "",
      date: appointment.date || "",
      reason: appointment.reason || ""
    },
    sections: []
  };

  // SECTION 1: Bring these documents
  const docs = ["Photo ID", "Insurance card (front and back)", "Current medication list", "List of questions below"];
  if (recentData.recentLabs && recentData.recentLabs.length > 0) {
    docs.push("Recent lab results from " + recentData.recentLabs[0].date);
  }
  if (recentData.recentImaging && recentData.recentImaging.length > 0) {
    docs.push("Imaging results: " + recentData.recentImaging.map(i => i.title || "scan").join(", "));
  }
  prep.sections.push({ title: "Bring These Documents", items: docs, icon: "📋" });

  // SECTION 2: Questions to ask based on recent changes
  const questions = [];
  const spec = (appointment.specialty || "").toLowerCase();
  const reason = (appointment.reason || "").toLowerCase();

  // Med changes trigger questions
  if (recentData.medChanges && recentData.medChanges.length > 0) {
    recentData.medChanges.forEach(mc => {
      questions.push("I had a medication change recently: " + mc.medication + " was " + mc.changeType + (mc.oldDose ? " from " + mc.oldDose : "") + (mc.newDose ? " to " + mc.newDose : "") + ". Are there any concerns?");
    });
  }

  // Symptom-based questions
  if (recentData.symptoms && recentData.symptoms.length > 0) {
    const symptomNames = [...new Set(recentData.symptoms.map(s => s.symptom))];
    symptomNames.forEach(sym => {
      questions.push("I've been experiencing " + sym + ". Could this be related to my medications or conditions?");
    });
  }

  // Lab-based questions
  if (recentData.labFlags && recentData.labFlags.length > 0) {
    recentData.labFlags.forEach(flag => {
      questions.push("My " + flag.test + " was " + flag.value + " " + (flag.unit || "") + " (" + flag.status + "). What does this mean for my treatment?");
    });
  }

  // Weight change questions
  if (recentData.weightChange) {
    questions.push("I've " + (recentData.weightChange > 0 ? "gained" : "lost") + " " + Math.abs(recentData.weightChange) + " pounds. Could this be related to my medications?");
  }

  // Specialty-specific questions
  if (spec.includes("eye") || spec.includes("ophthalm") || reason.includes("eye") || reason.includes("dry")) {
    questions.push("Can you do a meibography to check the state of my oil glands?");
    questions.push("Could my thyroid medication changes be affecting my eyes?");
    questions.push("I use autologous serum tears — could my blood chemistry (cholesterol, hormones) be affecting their quality?");
    questions.push("Should we check for Demodex?");
    questions.push("Would low-dose doxycycline (40mg Oracea) help with ocular rosacea?");
    questions.push("Are there any topical hormone treatments (testosterone or DHEA) for my eyelids?");
  }
  if (spec.includes("endo") || reason.includes("thyroid") || reason.includes("hormone")) {
    questions.push("My weight has changed — could my thyroid dose need adjustment?");
    questions.push("Should we check my SHBG, estradiol, and free testosterone levels?");
    questions.push("Is my current TSH level optimal for how I feel, not just within range?");
    questions.push("Could my thyroid medication be affecting my cholesterol?");
    questions.push("Given my breast cancer family history, what non-estrogen hormonal options are available?");
  }
  if (spec.includes("pain") || spec.includes("spine") || reason.includes("back") || reason.includes("neuro")) {
    questions.push("Based on my imaging, is the foraminal narrowing at L3/L4 causing my neuropathy symptoms?");
    questions.push("Would epidural steroid injections at L3/L4 help?");
    questions.push("Am I a candidate for spinal cord stimulation?");
    questions.push("Are there any new treatments for post-fusion adjacent segment disease?");
  }
  if (spec.includes("intern") || spec.includes("primary")) {
    questions.push("Can you review all my medications together for interactions or unnecessary drugs?");
    questions.push("My cholesterol is unusual (very high HDL, high LDL, zero calcium score) — what does this mean?");
    questions.push("I'd like you to coordinate with my specialists. Can we set that up?");
    questions.push("Are there any preventive screenings I'm overdue for?");
  }
  if (spec.includes("vein") || reason.includes("vein") || reason.includes("bruise")) {
    questions.push("The bruising from my last procedure has lasted longer than expected. Is this normal?");
    questions.push("Could my high HDL or any medications be affecting my healing?");
    questions.push("Do I need any follow-up imaging?");
  }

  // Always add these
  questions.push("Is there anything about my case that you think we should be doing differently?");
  questions.push("When should I schedule my next follow-up?");

  prep.sections.push({ title: "Questions To Ask", items: questions, icon: "❓" });

  // SECTION 3: Medications to mention
  if (patient.medications && patient.medications.length > 0) {
    const meds = patient.medications.map(m => m.name + (m.dose ? " " + m.dose : "") + (m.frequency ? " — " + m.frequency : ""));
    prep.sections.push({ title: "Current Medications", items: meds, icon: "💊" });
  }

  // SECTION 4: Recent concerns
  if (recentData.concerns && recentData.concerns.length > 0) {
    prep.sections.push({ title: "Unresolved Concerns", items: recentData.concerns, icon: "⚠️" });
  }

  // SECTION 5: Preparation instructions
  const prepInstructions = [];
  if (reason.includes("lab") || reason.includes("blood")) {
    prepInstructions.push("Confirm fasting requirements — usually 8-12 hours before blood draw");
    prepInstructions.push("Drink plenty of water the night before");
    prepInstructions.push("Check if you should take morning medications before the draw");
  }
  if (reason.includes("ct") || reason.includes("mri") || reason.includes("scan") || reason.includes("imaging")) {
    prepInstructions.push("Remove all jewelry and metal before the scan");
    prepInstructions.push("If contrast dye is used and patient takes Metformin — stop Metformin 48 hours before");
    prepInstructions.push("Wear comfortable clothing without metal zippers or buttons");
  }
  if (reason.includes("surgery") || reason.includes("procedure")) {
    prepInstructions.push("Confirm NPO (nothing by mouth) requirements");
    prepInstructions.push("Arrange transportation home — no driving after sedation");
    prepInstructions.push("Confirm which medications to take or skip the morning of");
  }
  prepInstructions.push("Arrive 15 minutes early for paperwork");
  prepInstructions.push("Bring a notebook or use Health Agent to record what the doctor says");
  prep.sections.push({ title: "Preparation Checklist", items: prepInstructions, icon: "✅" });

  return prep;
}

function formatPrepAsText(prep) {
  let t = "";
  t += "═══════════════════════════════════════════\n";
  t += "  APPOINTMENT PREP\n";
  t += "  " + prep.appointment.doctor + "\n";
  t += "  " + prep.appointment.date + " — " + (prep.appointment.reason || prep.appointment.specialty || "") + "\n";
  t += "═══════════════════════════════════════════\n\n";
  for (const section of prep.sections) {
    t += section.icon + " " + section.title + "\n";
    t += "───────────────────────────────────────────\n";
    section.items.forEach((item, i) => {
      t += "  " + (i + 1) + ". " + item + "\n";
    });
    t += "\n";
  }
  t += "Generated by Health Agent\n";
  return t;
}

module.exports = { generateSmartPrep, formatPrepAsText };
