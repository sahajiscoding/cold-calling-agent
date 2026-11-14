import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root
config({ path: resolve(process.cwd(), ".env") });

export const Config = {
  // Database
  DB_PATH: process.env.DB_PATH || "./data/crm.db",

  // WhatsApp Business API
  WHATSAPP: {
    BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || "",
    PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    PHONE_NUMBER: process.env.WHATSAPP_PHONE_NUMBER || "",
    API_VERSION: process.env.WHATSAPP_API_VERSION || "v21.0",
    get baseURL() {
      return `https://graph.facebook.com/${this.API_VERSION}`;
    },
    get headers() {
      return {
        Authorization: `Bearer ${this.ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      };
    },
  },

  // Google Places API
  GOOGLE_PLACES: {
    API_KEY: process.env.GOOGLE_PLACES_API_KEY || "",
    get baseURL() {
      return "https://maps.googleapis.com/maps/api/place";
    },
  },

  // App Configuration
  APP: {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: parseInt(process.env.PORT || "3000", 10),
    HOST: process.env.HOST || "0.0.0.0",
  },

  // Agent Settings
  AGENT: {
    MAX_DAILY_MESSAGES: parseInt(process.env.MAX_DAILY_MESSAGES || "100", 10),
    MESSAGE_DELAY_MS: parseInt(process.env.MESSAGE_DELAY_MS || "3000", 10),
    BUSINESS_HOURS_START: process.env.BUSINESS_HOURS_START || "09:00",
    BUSINESS_HOURS_END: process.env.BUSINESS_HOURS_END || "18:00",
    TIMEZONE: process.env.TIMEZONE || "Asia/Kolkata",
    AUTO_SEND_ENABLED: process.env.AUTO_SEND_ENABLED !== "false",
    RESEARCH_ENABLED: process.env.RESEARCH_ENABLED !== "false",
    TARGET_WITHOUT_WEBSITE: process.env.TARGET_WITHOUT_WEBSITE !== "false",
  },

  // Logging
  LOG: {
    LEVEL: process.env.LOG_LEVEL || "info",
    FILE: process.env.LOG_FILE || "./logs/agent.log",
  },
};

// Validate required environment variables
export function validateConfig(): string[] {
  const errors: string[] = [];

  if (!Config.WHATSAPP.ACCESS_TOKEN) {
    errors.push("WHATSAPP_ACCESS_TOKEN is required");
  }
  if (!Config.WHATSAPP.PHONE_NUMBER_ID) {
    errors.push("WHATSAPP_PHONE_NUMBER_ID is required");
  }
  if (!Config.GOOGLE_PLACES.API_KEY) {
    errors.push("GOOGLE_PLACES_API_KEY is required");
  }

  return errors;
}

export default Config;