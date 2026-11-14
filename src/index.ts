import { db, initializeDatabase } from "./db";
import {
  coldCallingCampaigns,
  coldCallingProspects,
  coldCallingMessages,
  coldCallingResearchJobs,
  coldCallingTemplates,
} from "./db/schema";
import { eq, and, or, isNull, sql, desc } from "drizzle-orm";
import { GooglePlacesService, ResearchResult } from "./services/google-places.service";
import { WhatsAppService } from "./services/whatsapp.service";
import { PlaywrightService } from "./services/playwright.service";
import { LLMService, ConversationContext, MessageAnalysis } from "./services/llm.service";
import { logger } from "./logger";
import { Config, validateConfig } from "./config";
import cron from "node-cron";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import {
  createCampaign,
  getCampaigns,
  getCampaign,
  updateCampaign,
  createProspect,
  getProspects,
  getProspect,
  updateProspect,
  updateProspectStatus,
  createMessage,
  getMessages,
  getMessage,
  updateMessageStatus,
  createResearchJob,
  getResearchJobs,
  updateResearchJob,
  getAutomationSetting,
  updateAutomationSetting,
  getStats,
} from "./db/queries";

// Initialize services
const googlePlaces = new GooglePlacesService();
const whatsapp = new WhatsAppService();
const playwright = new PlaywrightService();
const llm = new LLMService();

// Agent state
let isRunning = false;
let dailyMessageCount = 0;
let lastResetDate = new Date().toDateString();

// Business hours checker
function isWithinBusinessHours(): boolean {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

  const start = Config.AGENT.BUSINESS_HOURS_START;
  const end = Config.AGENT.BUSINESS_HOURS_END;

  return currentTime >= start && currentTime <= end;
}

// Reset daily message counter
async function resetDailyCounter() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    const setting = await getAutomationSetting("daily_message_limit");
    const limit = setting ? parseInt(setting.value) : Config.AGENT.MAX_DAILY_MESSAGES;
    dailyMessageCount = 0;
    lastResetDate = today;
    logger.info("Daily message counter reset", { date: today, limit });
  }
}

// Get prospects ready for contact
async function getPendingProspects(campaignId?: string) {
  await resetDailyCounter();

  const setting = await getAutomationSetting("daily_message_limit");
  const maxMessages = setting ? parseInt(setting.value) : Config.AGENT.MAX_DAILY_MESSAGES;

  if (dailyMessageCount >= maxMessages) {
    logger.info("Daily message limit reached", {
      sent: dailyMessageCount,
      limit: maxMessages,
    });
    return [];
  }

  let query = db
    .select()
    .from(coldCallingProspects)
    .where(
      and(
        eq(coldCallingProspects.status, "new"),
        Config.AGENT.TARGET_WITHOUT_WEBSITE
          ? eq(coldCallingProspects.websiteFound, false)
          : undefined
      )
    );

  if (campaignId) {
    query = query.where(eq(coldCallingProspects.campaignId, campaignId));
  }

  return await query.limit(50).orderBy(coldCallingProspects.createdAt);
}

// Process research job
async function processResearchJob(jobId: string, query: string, location?: string) {
  try {
    logger.info("Starting research job", { jobId, query, location });

    // Update job status
    await updateResearchJob(jobId, { status: "running" });

    // Research businesses
    const results = await googlePlaces.researchBusinesses(query, location);

    // Filter businesses without websites if configured
    const filteredResults = Config.AGENT.TARGET_WITHOUT_WEBSITE
      ? googlePlaces.filterBusinessesWithoutWebsite(results)
      : results;

    // Get campaign ID from job
    const job = await db
      .select()
      .from(coldCallingResearchJobs)
      .where(eq(coldCallingResearchJobs.id, jobId))
      .limit(1);

    const campaignId = job[0]?.campaignId || undefined;

    // Save prospects to database
    for (const result of filteredResults) {
      await createProspect({
        campaignId,
        businessName: result.businessName,
        ownerName: result.businessName,
        phoneNumber: result.phoneNumber,
        email: result.email,
        address: result.address,
        city: result.location?.split(",")[0],
        state: result.location?.split(",")[1]?.trim(),
        websiteFound: result.hasWebsite,
        websiteUrl: result.website,
        hasWhatsapp: result.hasWhatsApp,
        status: "new",
        researchData: result as any,
      });
    }

    // Update job status
    await updateResearchJob(jobId, {
      status: "completed",
      resultsCount: filteredResults.length,
      completedAt: new Date().toISOString(),
    });

    logger.info("Research job completed", {
      jobId,
      totalResults: results.length,
      savedProspects: filteredResults.length,
    });

    return filteredResults.length;
  } catch (error: any) {
    logger.error("Research job failed", {
      jobId,
      error: error.message,
    });

    // Update job status to failed
    await updateResearchJob(jobId, { status: "failed" });
    return 0;
  }
}

// Send message to prospect
async function contactProspect(prospectId: string, templateName?: string) {
  const setting = await getAutomationSetting("daily_message_limit");
  const maxMessages = setting ? parseInt(setting.value) : Config.AGENT.MAX_DAILY_MESSAGES;

  if (dailyMessageCount >= maxMessages) {
    logger.info("Daily message limit reached", {
      sent: dailyMessageCount,
      limit: maxMessages,
    });
    return false;
  }

  if (!isWithinBusinessHours()) {
    logger.info("Outside business hours, skipping message", {
      currentTime: new Date().toTimeString().slice(0, 5),
      businessHours: `${Config.AGENT.BUSINESS_HOURS_START}-${Config.AGENT.BUSINESS_HOURS_END}`,
    });
    return false;
  }

  try {
    // Get prospect details
    const prospect = await getProspect(prospectId);

    if (!prospect) {
      logger.error("Prospect not found", { prospectId });
      return false;
    }

    if (!prospect.phoneNumber) {
      logger.error("Prospect has no phone number", { prospectId });
      return false;
    }

    // Determine message content
    let messageContent: string;
    let whatsappTemplate: any;

    if (templateName) {
      // Use template message
      const templates = await db
        .select()
        .from(coldCallingTemplates)
        .where(eq(coldCallingTemplates.name, templateName))
        .limit(1);

      if (templates.length === 0) {
        logger.error("Template not found", { templateName });
        return false;
      }

      const template = templates[0];
      whatsappTemplate = {
        name: template.name,
        language: template.language,
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: prospect.businessName }],
          },
        ],
      };
      messageContent = template.content;
    } else {
      // Use default message
      messageContent = `Hello! We noticed that ${prospect.businessName} doesn't have a website yet. We help businesses like yours get online presence quickly and affordably. Would you be interested in learning more?`;
    }

    logger.info("Sending message to prospect", {
      prospectId,
      businessName: prospect.businessName,
      phoneNumber: prospect.phoneNumber,
      templateName,
    });

    // Send WhatsApp message
    let messageId: string;
    if (whatsappTemplate) {
      const result = await whatsapp.sendTemplateMessage(
        prospect.phoneNumber,
        whatsappTemplate
      );
      messageId = result.id;
    } else {
      const result = await whatsapp.sendTextMessage(
        prospect.phoneNumber,
        messageContent
      );
      messageId = result.id;
    }

    // Save message to database
    await createMessage({
      prospectId,
      campaignId: prospect.campaignId,
      direction: "outbound",
      messageType: whatsappTemplate ? "template" : "text",
      content: messageContent,
      templateName,
      whatsappMessageId: messageId,
      status: "sent",
      sentAt: new Date().toISOString(),
    });

    // Update prospect status
    await updateProspectStatus(prospectId, "contacted");

    // Update daily counter
    dailyMessageCount++;

    logger.info("Message sent successfully", {
      prospectId,
      messageId,
      dailyMessageCount,
      remaining: maxMessages - dailyMessageCount,
    });

    return true;
  } catch (error: any) {
    logger.error("Failed to contact prospect", {
      prospectId,
      error: error.message,
    });

    return false;
  }
}

// Process incoming WhatsApp message
async function processIncomingMessage(
  messageId: string,
  from: string,
  messageType: string,
  content: string
) {
  logger.info("Processing incoming WhatsApp message", {
    messageId,
    from,
    messageType,
    content: content.substring(0, 100),
  });

  try {
    // Find prospect by phone number
    const prospects = await db
      .select()
      .from(coldCallingProspects)
      .where(eq(coldCallingProspects.phoneNumber, from))
      .limit(1);

    if (prospects.length === 0) {
      logger.warn("Received message from unknown number", { from });
      return;
    }

    const prospect = prospects[0];

    // Save incoming message
    await createMessage({
      prospectId: prospect.id,
      campaignId: prospect.campaignId,
      direction: "inbound",
      messageType: messageType as any,
      content,
      whatsappMessageId: messageId,
      status: "received",
    });

    // Get conversation history
    const history = await getMessages(prospect.id);

    // Build conversation context
    const context: ConversationContext = {
      prospectId: prospect.id,
      businessName: prospect.businessName,
      history: history
        .filter((h) => h.direction === "outbound")
        .map((h) => ({
          role: "assistant",
          content: h.content || "",
          timestamp: h.sentAt || h.createdAt || new Date().toISOString(),
        })),
    };

    // Analyze message with LLM
    const analysis = await llm.analyzeMessage(context, content);

    // Update prospect status based on analysis
    let newStatus = prospect.status;
    if (llm.isInterested(analysis)) {
      newStatus = "interested";
    } else if (analysis.sentiment === "negative") {
      newStatus = "not_interested";
    } else if (llm.requiresFollowUp(analysis)) {
      newStatus = "follow_up";
    }

    if (newStatus !== prospect.status) {
      await updateProspectStatus(prospect.id, newStatus);
    }

    // Generate and send response if needed
    if (analysis.requiresResponse && Config.AGENT.AUTO_SEND_ENABLED) {
      const response = await llm.generateResponse(context, analysis);

      // Send response
      await whatsapp.sendTextMessage(prospect.phoneNumber!, response);

      // Save response to database
      await createMessage({
        prospectId: prospect.id,
        campaignId: prospect.campaignId,
        direction: "outbound",
        messageType: "text",
        content: response,
        status: "sent",
        sentAt: new Date().toISOString(),
      });

      logger.info("Auto-response sent", {
        prospectId: prospect.id,
        responseLength: response.length,
      });
    }

    logger.info("Incoming message processed", {
      prospectId: prospect.id,
      analysis,
      newStatus,
    });
  } catch (error: any) {
    logger.error("Failed to process incoming message", {
      messageId,
      from,
      error: error.message,
    });
  }
}

// Main agent cycle
async function runAgentCycle() {
  if (isRunning) {
    logger.warn("Agent already running, skipping cycle");
    return;
  }

  isRunning = true;
  logger.info("Starting agent cycle");

  try {
    // Process pending research jobs
    const pendingJobs = await db
      .select()
      .from(coldCallingResearchJobs)
      .where(eq(coldCallingResearchJobs.status, "pending"))
      .limit(5);

    for (const job of pendingJobs) {
      await processResearchJob(job.id, job.searchQuery, job.location || undefined);
    }

    // Get prospects ready for contact
    const prospects = await getPendingProspects();

    if (prospects.length > 0) {
      logger.info("Found prospects to contact", { count: prospects.length });

      // Contact prospects one by one with delay
      for (const prospect of prospects) {
        if (!isRunning) break;

        const success = await contactProspect(
          prospect.id,
          undefined // Use default message for now
        );

        if (success) {
          // Add delay between messages to respect rate limits
          await new Promise((resolve) =>
            setTimeout(resolve, Config.AGENT.MESSAGE_DELAY_MS)
          );
        }
      }
    } else {
      logger.info("No prospects to contact in this cycle");
    }
  } catch (error: any) {
    logger.error("Error in agent cycle", { error: error.message });
  } finally {
    isRunning = false;
    logger.info("Agent cycle completed");
  }
}

// Start scheduled tasks
function startScheduledTasks() {
  logger.info("Starting scheduled tasks");

  // Run agent every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    await runAgentCycle();
  });

  // Reset daily counter at midnight
  cron.schedule("0 0 * * *", async () => {
    await resetDailyCounter();
  });

  // Check for failed messages every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    try {
      const failedMessages = await db
        .select()
        .from(coldCallingMessages)
        .where(eq(coldCallingMessages.status, "failed"))
        .limit(10);

      for (const msg of failedMessages) {
        // Retry failed messages (max 3 attempts)
        // Implementation would track retry count
      }
    } catch (error: any) {
      logger.error("Error checking failed messages", { error: error.message });
    }
  });

  logger.info("Scheduled tasks started");
}

// Express API for dashboard
function createAPI() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/health", async (req, res) => {
    try {
      const stats = await getStats();
      res.json({
        status: "ok",
        isRunning,
        stats,
        businessHours: `${Config.AGENT.BUSINESS_HOURS_START}-${Config.AGENT.BUSINESS_HOURS_END}`,
        currentTime: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get stats
  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await getStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get campaigns
  app.get("/api/campaigns", async (req, res) => {
    try {
      const campaigns = await getCampaigns();
      res.json(campaigns);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create campaign
  app.post("/api/campaigns", async (req, res) => {
    try {
      const { name, description, targetIndustry, targetLocation } = req.body;

      const campaign = await createCampaign(
        name,
        description,
        targetIndustry,
        targetLocation
      );

      res.status(201).json(campaign);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get prospects
  app.get("/api/prospects", async (req, res) => {
    try {
      const { status, campaignId } = req.query;
      const prospects = await getProspects(
        campaignId as string,
        status as string
      );
      res.json(prospects);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create prospect
  app.post("/api/prospects", async (req, res) => {
    try {
      const prospect = await createProspect(req.body);
      res.status(201).json(prospect);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get messages
  app.get("/api/messages", async (req, res) => {
    try {
      const { prospectId, campaignId } = req.query;
      const messages = await getMessages(
        prospectId as string,
        campaignId as string
      );
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get research jobs
  app.get("/api/research", async (req, res) => {
    try {
      const { campaignId, status } = req.query;
      const jobs = await getResearchJobs(
        campaignId as string,
        status as string
      );
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create research job
  app.post("/api/research", async (req, res) => {
    try {
      const { query, location, campaignId } = req.body;

      const job = await createResearchJob(query, location, undefined, campaignId);

      res.status(201).json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manual trigger agent cycle
  app.post("/api/trigger", async (req, res) => {
    try {
      await runAgentCycle();
      res.json({ success: true, message: "Agent cycle triggered" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // WhatsApp webhook for incoming messages
  app.post("/api/webhook", async (req, res) => {
    try {
      const { entry } = req.body;

      // Process each entry
      for (const e of entry) {
        for (const change of e.changes) {
          const value = change.value;

          if (value.messages) {
            for (const message of value.messages) {
              await processIncomingMessage(
                message.id,
                message.from,
                message.type,
                message.text?.body || message.button?.text || ""
              );
            }
          }

          if (value.statuses) {
            for (const status of value.statuses) {
              // Update message status
              await updateMessageStatus(status.id, status.status);
            }
          }
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Start API server
  app.listen(Config.APP.PORT, Config.APP.HOST, () => {
    logger.info("API server started", {
      host: Config.APP.HOST,
      port: Config.APP.PORT,
    });
  });

  return app;
}

// Main entry point
async function main() {
  logger.info("Starting Cold Calling Agent");

  // Validate configuration
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    logger.error("Configuration validation failed", { errors: configErrors });
    process.exit(1);
  }

  try {
    // Initialize database
    await initializeDatabase();
    logger.info("Database initialized");

    // Initialize services
    await playwright.initialize();
    logger.info("Services initialized");

    // Start scheduled tasks
    startScheduledTasks();

    // Start API server
    createAPI();

    // Run initial agent cycle
    await runAgentCycle();

    logger.info("Cold Calling Agent started successfully");
  } catch (error: any) {
    logger.error("Failed to start agent", { error: error.message });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully");
  await playwright.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  await playwright.close();
  process.exit(0);
});

// Start the agent
main().catch((error) => {
  logger.error("Fatal error in agent", { error: error.message });
  process.exit(1);
});