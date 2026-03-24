const Database = require("better-sqlite3");
const path = require("path");
const db = new Database(path.join(__dirname, "data", "dealmatcher.db"));

// Enable WAL mode for better concurrent access
db.pragma("journal_mode = WAL");

// === LEADS TABLE ===
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    linkedin TEXT,
    instagram TEXT,
    source TEXT DEFAULT 'manual',
    source_detail TEXT,
    
    -- Pipeline status
    status TEXT DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','negotiating','active','closed_won','closed_lost','dead')),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('hot','high','medium','low','cold')),
    
    -- Verification scores (0-100)
    verification_score INTEGER DEFAULT 0,
    company_verified INTEGER DEFAULT 0,
    linkedin_verified INTEGER DEFAULT 0,
    pof_verified INTEGER DEFAULT 0,
    identity_verified INTEGER DEFAULT 0,
    
    -- Deal info
    deal_types TEXT,
    asset_types TEXT,
    price_range_min REAL,
    price_range_max REAL,
    markets TEXT,
    capital_available TEXT,
    pof_document TEXT,
    pof_status TEXT DEFAULT 'not_requested' CHECK(pof_status IN ('not_requested','requested','received','verified','rejected')),
    
    -- Communication
    last_contact_date TEXT,
    next_followup_date TEXT,
    notes TEXT,
    
    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// === LEAD ACTIVITIES TABLE ===
db.exec(`
  CREATE TABLE IF NOT EXISTS lead_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );
`);

// === VERIFICATION RESULTS TABLE ===
db.exec(`
  CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','verified','failed','inconclusive')),
    result_data TEXT,
    source TEXT,
    verified_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );
`);

// === SUBSCRIBERS TABLE (upgrade existing) ===
db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    company TEXT,
    plan TEXT DEFAULT 'free',
    status TEXT DEFAULT 'active',
    lead_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  );
`);

// === DEAL PIPELINE TABLE ===
db.exec(`
  CREATE TABLE IF NOT EXISTS deal_pipeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    listing_id INTEGER,
    deal_name TEXT NOT NULL,
    deal_value REAL,
    fee_amount REAL,
    status TEXT DEFAULT 'prospect' CHECK(status IN ('prospect','intro_made','negotiating','under_contract','due_diligence','closing','closed','dead')),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  );
`);

// Insert Gary as first lead if not exists
const existing = db.prepare("SELECT id FROM leads WHERE company = 'Tru Vizions LLC'").get();
if (!existing) {
  db.prepare(`
    INSERT INTO leads (name, email, company, source, source_detail, status, priority, deal_types, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "Gary Randal",
    null,
    "Tru Vizions LLC",
    "instagram",
    "First confirmed subscriber",
    "new",
    "high",
    "real_estate",
    "First subscriber. Confirmed via DealMatcher subscribe page. Needs verification — company lookup, LinkedIn check."
  );
  console.log("✅ Gary Randal (Tru Vizions LLC) added as lead #1");
}

// Insert Instagram lead
const existing2 = db.prepare("SELECT id FROM leads WHERE instagram = 'nikolas_w_schlosser'").get();
if (!existing2) {
  db.prepare(`
    INSERT INTO leads (name, instagram, source, source_detail, status, priority, deal_types, capital_available, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "Nikolas W. Schlosser",
    "nikolas_w_schlosser",
    "instagram",
    "Replied to DealMatcher comment — verified account, asked 'Do you have capital?'",
    "new",
    "hot",
    "real_estate",
    "Has deals, asking about capital",
    "Verified Instagram account. Engaged on entrepreneur post. Has deal flow, wants to know about capital/buyers. High priority — respond with asset types and price ranges."
  );
  console.log("✅ Nikolas Schlosser added as lead #2 (HOT)");
}

console.log("");
console.log("✅ Lead database schema created");
console.log("Tables: leads, lead_activities, verifications, subscribers, deal_pipeline");

const leadCount = db.prepare("SELECT COUNT(*) as count FROM leads").get();
console.log("Total leads:", leadCount.count);

db.close();
