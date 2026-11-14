import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./src/db/crm.db",
  },
  tables: [
    "cold_calling_campaigns",
    "cold_calling_prospects",
    "cold_calling_messages",
    "cold_calling_research_jobs",
  ],
} satisfies Config;