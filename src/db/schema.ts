import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  unique,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Campaigns table - tracks outreach campaigns
export const coldCallingCampaigns = sqliteTable(
  "cold_calling_campaigns",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    targetIndustry: text("target_industry"),
    targetLocation: text("target_location"),
    status: text("status", {
      enum: ["active", "paused", "completed"],
    })
      .notNull()
      .default("active"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("campaigns_status_idx").on(table.status),
  ]
);

// Prospects table - businesses to contact
export const coldCallingProspects = sqliteTable(
  "cold_calling_prospects",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id").references(
      () => coldCallingCampaigns.id,
      { onDelete: "cascade" }
    ),
    businessName: text("business_name").notNull(),
    ownerName: text("owner_name"),
    phoneNumber: text("phone_number"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),
    websiteFound: integer("website_found", { mode: "boolean" })
      .notNull()
      .default(false),
    websiteUrl: text("website_url"),
    hasWhatsapp: integer("has_whatsapp", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", {
      enum: [
        "new",
        "contacted",
        "responded",
        "not_interested",
        "interested",
        "follow_up",
      ],
    })
      .notNull()
      .default("new"),
    notes: text("notes"),
    researchData: text("research_data", { mode: "json" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    lastContactedAt: text("last_contacted_at"),
  },
  (table) => [
    index("prospects_campaign_idx").on(table.campaignId),
    index("prospects_status_idx").on(table.status),
    index("prospects_phone_idx").on(table.phoneNumber),
    index("prospects_website_idx").on(table.websiteFound),
  ]
);

// Messages table - WhatsApp message history
export const coldCallingMessages = sqliteTable(
  "cold_calling_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    prospectId: text("prospect_id").references(
      () => coldCallingProspects.id,
      { onDelete: "cascade" }
    ),
    campaignId: text("campaign_id").references(
      () => coldCallingCampaigns.id,
      { onDelete: "cascade" }
    ),
    direction: text("direction", {
      enum: ["outbound", "inbound"],
    }).notNull(),
    messageType: text("message_type", {
      enum: ["text", "template", "image"],
    })
      .notNull()
      .default("text"),
    content: text("content"),
    templateName: text("template_name"),
    whatsappMessageId: text("whatsapp_message_id"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    sentAt: text("sent_at"),
    deliveredAt: text("delivered_at"),
    readAt: text("read_at"),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("messages_prospect_idx").on(table.prospectId),
    index("messages_status_idx").on(table.status),
    index("messages_whatsapp_id_idx").on(table.whatsappMessageId),
  ]
);

// Research jobs table - tracks business research tasks
export const coldCallingResearchJobs = sqliteTable(
  "cold_calling_research_jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id").references(
      () => coldCallingCampaigns.id,
      { onDelete: "cascade" }
    ),
    searchQuery: text("search_query").notNull(),
    location: text("location"),
    industry: text("industry"),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    resultsCount: integer("results_count").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("research_jobs_campaign_idx").on(table.campaignId),
    index("research_jobs_status_idx").on(table.status),
  ]
);

// WhatsApp templates table - stores approved Meta templates
export const coldCallingTemplates = sqliteTable(
  "cold_calling_templates",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    category: text("category", {
      enum: ["marketing", "utility", "authentication"],
    }).notNull(),
    language: text("language").notNull().default("en"),
    content: text("content").notNull(),
    variables: text("variables", { mode: "json" }),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    unique("templates_name_language_unique").on(
      table.name,
      table.language
    ),
  ]
);

// Automation settings table - controls agent behavior
export const coldCallingAutomationSettings = sqliteTable(
  "cold_calling_automation_settings",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    key: text("key").notNull().unique(),
    value: text("value").notNull(),
    description: text("description"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  }
);

// Export all tables for relations
export const schema = {
  coldCallingCampaigns,
  coldCallingProspects,
  coldCallingMessages,
  coldCallingResearchJobs,
  coldCallingTemplates,
  coldCallingAutomationSettings,
};