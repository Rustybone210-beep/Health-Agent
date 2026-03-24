const express = require("express");
const router = express.Router();
const Database = require("better-sqlite3");
const path = require("path");
const db = new Database(path.join(__dirname, "../../data/dealmatcher.db"));

// Company lookup — searches public business registrations
router.post("/company", (req, res) => {
  try {
    const { company, state } = req.body;
    if (!company) return res.status(400).json({ error: "Company name required" });

    // Store verification attempt
    const lead = db.prepare("SELECT id FROM leads WHERE company LIKE ?").get("%" + company + "%");

    const result = {
      company_name: company,
      search_state: state || "ALL",
      search_urls: {
        texas_sos: "https://mycpa.cpa.state.tx.us/coa/coaSearchBtn",
        california_sos: "https://bizfileonline.sos.ca.gov/search/business",
        florida_sunbiz: "https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
        sec_edgar: "https://www.sec.gov/cgi-bin/browse-edgar?company=" + encodeURIComponent(company) + "&CIK=&type=&dateb=&owner=include&count=40&search_text=&action=getcompany",
        opencorporates: "https://opencorporates.com/companies?q=" + encodeURIComponent(company),
        linkedin: "https://www.linkedin.com/search/results/companies/?keywords=" + encodeURIComponent(company),
        bbb: "https://www.bbb.org/search?find_text=" + encodeURIComponent(company),
        google: "https://www.google.com/search?q=" + encodeURIComponent('"' + company + '" business registration'),
      },
      checklist: [
        { item: "Secretary of State registration", status: "pending" },
        { item: "Active/Good standing status", status: "pending" },
        { item: "Registered agent on file", status: "pending" },
        { item: "Formation date", status: "pending" },
        { item: "BBB listing", status: "pending" },
        { item: "LinkedIn company page", status: "pending" },
        { item: "Physical address verified", status: "pending" },
      ],
      instructions: "Open the search URLs above to verify this company. Check each item on the checklist and update the lead verification status."
    };

    if (lead) {
      db.prepare("INSERT INTO verifications (lead_id, type, status, result_data, source) VALUES (?, ?, ?, ?, ?)").run(lead.id, "company", "pending", JSON.stringify(result), "manual_lookup");
      db.prepare("INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)").run(lead.id, "verification", "Company verification initiated", "Looking up: " + company);
    }

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: "Verification failed" });
  }
});

// LinkedIn verification
router.post("/linkedin", (req, res) => {
  try {
    const { name, company, linkedin_url } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });

    const result = {
      person: name,
      company: company || "Unknown",
      search_urls: {
        linkedin_people: "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(name + (company ? " " + company : "")),
        linkedin_direct: linkedin_url || null,
        google_linkedin: "https://www.google.com/search?q=" + encodeURIComponent('site:linkedin.com "' + name + '"' + (company ? ' "' + company + '"' : "")),
      },
      checklist: [
        { item: "Profile exists and matches name", status: "pending" },
        { item: "Current company matches claimed company", status: "pending" },
        { item: "Profile has 100+ connections", status: "pending" },
        { item: "Profile has activity/posts", status: "pending" },
        { item: "Profile photo looks legitimate", status: "pending" },
        { item: "Endorsements/recommendations present", status: "pending" },
        { item: "Account age (not brand new)", status: "pending" },
      ],
      red_flags: [
        "New account (< 6 months)",
        "No connections or very few",
        "No profile photo",
        "No work history",
        "Generic/stock photo",
        "Name doesn't match other records",
      ]
    };

    const lead = db.prepare("SELECT id FROM leads WHERE name LIKE ? OR company LIKE ?").get("%" + name + "%", "%" + (company || "NOMATCH") + "%");
    if (lead) {
      db.prepare("INSERT INTO verifications (lead_id, type, status, result_data, source) VALUES (?, ?, ?, ?, ?)").run(lead.id, "linkedin", "pending", JSON.stringify(result), "manual_lookup");
      db.prepare("INSERT INTO lead_activities (lead_id, type, title, description) VALUES (?, ?, ?, ?)").run(lead.id, "verification", "LinkedIn verification initiated", "Looking up: " + name);
    }

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: "Verification failed" });
  }
});

// Update verification status
router.put("/:verificationId", (req, res) => {
  try {
    const { status, result_data } = req.body;
    const v = db.prepare("SELECT * FROM verifications WHERE id = ?").get(req.params.verificationId);
    if (!v) return res.status(404).json({ error: "Verification not found" });

    db.prepare("UPDATE verifications SET status = ?, result_data = ?, verified_at = datetime('now') WHERE id = ?").run(status || v.status, result_data || v.result_data, req.params.verificationId);

    // Update lead verification score
    const leadVerifications = db.prepare("SELECT * FROM verifications WHERE lead_id = ?").all(v.lead_id);
    const verified = leadVerifications.filter(lv => lv.status === "verified").length;
    const total = leadVerifications.length;
    const score = total > 0 ? Math.round((verified / total) * 100) : 0;

    const typeScores = { company: 0, linkedin: 0, pof: 0, identity: 0 };
    for (const lv of leadVerifications) {
      if (lv.status === "verified" && typeScores.hasOwnProperty(lv.type)) {
        typeScores[lv.type] = 1;
      }
    }

    db.prepare("UPDATE leads SET verification_score = ?, company_verified = ?, linkedin_verified = ?, pof_verified = ?, identity_verified = ?, updated_at = datetime('now') WHERE id = ?").run(score, typeScores.company, typeScores.linkedin, typeScores.pof, typeScores.identity, v.lead_id);

    res.json({ success: true, score });
  } catch (error) {
    res.status(500).json({ error: "Failed to update verification" });
  }
});

module.exports = router;
