import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { drizzle, SqlJsRemoteDatabase } from "drizzle-orm/sql-js";
import * as schema from "./schema";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { logger } from "../logger";

const DB_PATH = process.env.DB_PATH || "./data/crm.db";

// Ensure directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Load or create database
let SQL: any;
let db: SqlJsRemoteDatabase<typeof schema>;

// Initialize sql.js and create Drizzle instance
export async function initializeDatabase() {
  logger.info("Initializing database at:", DB_PATH);

  // Initialize sql.js
  SQL = await initSqlJs();

  // Load existing database or create new
  let filebuffer: Uint8Array | undefined;
  if (existsSync(DB_PATH)) {
    filebuffer = readFileSync(DB_PATH);
  }

  const sqlJsDb = new SQL.Database(filebuffer);
  db = drizzle(sqlJsDb, { schema });

  // Create tables if they don't exist
  sqlJsDb.exec(`
    CREATE TABLE IF NOT EXISTS cold_calling_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      target_industry TEXT,
      target_location TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
      created_at TEXT NOT NULL DEFAULT (current_timestamp),
      updated_at TEXT NOT NULL DEFAULT (current_timestamp)
    );

    CREATE TABLE IF NOT EXISTS cold_calling_prospects (
      id TEXT PRIMARY KEY,
      campaign_id TEXT,
      business_name TEXT NOT NULL,
      owner_name TEXT,
      phone_number TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip_code TEXT,
      website_found INTEGER DEFAULT 0 CHECK (website_found IN (0, 1)),
      website_url TEXT,
      has_whatsapp INTEGER DEFAULT 0 CHECK (has_whatsapp IN (0, 1)),
      status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'responded', 'not_interested', 'interested', 'follow_up')),
      notes TEXT,
      research_data TEXT,
      created_at TEXT NOT NULL DEFAULT (current_timestamp),
      updated_at TEXT NOT NULL DEFAULT (current_timestamp),
      last_contacted_at TEXT,
      FOREIGN KEY (campaign_id) REFERENCES cold_calling_campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cold_calling_messages (
      id TEXT PRIMARY KEY,
      prospect_id TEXT,
      campaign_id TEXT,
      direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
      message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'template', 'image')),
      content TEXT,
      template_name TEXT,
      whatsapp_message_id TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
      sent_at TEXT,
      delivered_at TEXT,
      read_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (current_timestamp),
      FOREIGN KEY (prospect_id) REFERENCES cold_calling_prospects(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES cold_calling_campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cold_calling_research_jobs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT,
      search_query TEXT NOT NULL,
      location TEXT,
      industry TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      results_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (current_timestamp),
      completed_at TEXT,
      FOREIGN KEY (campaign_id) REFERENCES cold_calling_campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cold_calling_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('marketing', 'utility', 'authentication')),
      language TEXT NOT NULL DEFAULT 'en',
      content TEXT NOT NULL,
      variables TEXT,
      is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (current_timestamp),
      updated_at TEXT NOT NULL DEFAULT (current_timestamp),
      UNIQUE(name, language)
    );

    CREATE TABLE IF NOT EXISTS cold_calling_automation_settings (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (current_timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_prospects_campaign ON cold_calling_prospects(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_prospects_status ON cold_calling_prospects(status);
    CREATE INDEX IF NOT EXISTS idx_prospects_phone ON cold_calling_prospects(phone_number);
    CREATE INDEX IF NOT EXISTS idx_prospects_website ON cold_calling_prospects(website_found);
    CREATE INDEX IF NOT EXISTS idx_messages_prospect ON cold_calling_messages(prospect_id);
    CREATE INDEX IF NOT EXISTS idx_messages_status ON cold_calling_messages(status);
    CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON cold_calling_messages(whatsapp_message_id);
    CREATE INDEX IF NOT EXISTS idx_research_jobs_campaign ON cold_calling_research_jobs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_research_jobs_status ON cold_calling_research_jobs(status);
  `);

  // Insert default automation settings
  const defaultSettings = [
    {
      key: "auto_send_enabled",
      value: "true",
      description: "Enable automatic message sending without human approval",
    },
    {
      key: "daily_message_limit",
      value: "100",
      description: "Maximum messages to send per day",
    },
    {
      key: "business_hours_start",
      value: "09:00",
      description: "Start time for sending messages (24h format)",
    },
    {
      key: "business_hours_end",
      value: "18:00",
      description: "End time for sending messages (24h format)",
    },
    {
      key: "timezone",
      value: "Asia/Kolkata",
      description: "Timezone for business hours",
    },
    {
      key: "rate_limit_delay_ms",
      value: "3000",
      description: "Delay between messages in milliseconds",
    },
    {
      key: "research_enabled",
      value: "true",
      description: "Enable automatic business research",
    },
    {
      key: "target_businesses_without_website",
      value: "true",
      description: "Only target businesses without websites",
    },
  ];

  for (const setting of defaultSettings) {
    sqlJsDb.exec(
      `INSERT OR IGNORE INTO cold_calling_automation_settings (id, key, value, description) VALUES (?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        setting.key,
        setting.value,
        setting.description,
      ]
    );
  }

  // Save database to disk
  saveDatabase(sqlJsDb);

  logger.info("Database initialized successfully");
  return { db: db, sqlJsDb };
}

// Save database to disk
function saveDatabase(sqlJsDb: SqlJsDatabase) {
  try {
    const data = sqlJsDb.export();
    writeFileSync(DB_PATH, Buffer.from(data));
  } catch (error) {
    logger.error("Failed to save database", { error });
  }
}

// Export db instance (will be initialized by main)
export { db };