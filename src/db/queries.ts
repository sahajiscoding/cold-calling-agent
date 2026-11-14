import { eq, and, or, isNull, sql, desc, like } from "drizzle-orm";
import { initializeDatabase } from "./index";
import { db } from "./index";
import * as schema from "./schema";
import { logger } from "../logger";

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  targetIndustry?: string;
  targetLocation?: string;
  status: "active" | "paused" | "completed";
  createdAt?: string;
  updatedAt?: string;
}

export interface Prospect {
  id: string;
  campaignId?: string;
  businessName: string;
  ownerName?: string;
  phoneNumber?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  websiteFound: boolean;
  websiteUrl?: string;
  hasWhatsapp: boolean;
  status: "new" | "contacted" | "responded" | "not_interested" | "interested" | "follow_up";
  notes?: string;
  researchData?: any;
  createdAt?: string;
  updatedAt?: string;
  lastContactedAt?: string;
}

export interface Message {
  id: string;
  prospectId: string;
  campaignId?: string;
  direction: "outbound" | "inbound";
  messageType: "text" | "template" | "image";
  content?: string;
  templateName?: string;
  whatsappMessageId?: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  errorMessage?: string;
  createdAt?: string;
}

export interface ResearchJob {
  id: string;
  campaignId?: string;
  searchQuery: string;
  location?: string;
  industry?: string;
  status: "pending" | "running" | "completed" | "failed";
  resultsCount: number;
  createdAt?: string;
  completedAt?: string;
}

export interface AutomationSetting {
  key: string;
  value: string;
  description?: string;
  updatedAt?: string;
}

// Campaign operations
export async function createCampaign(
  name: string,
  description?: string,
  targetIndustry?: string,
  targetLocation?: string
): Promise<Campaign> {
  const [campaign] = await db
    .insert(schema.coldCallingCampaigns)
    .values({
      name,
      description,
      targetIndustry,
      targetLocation,
      status: "active",
    })
    .returning();

  logger.info("Campaign created", { campaignId: campaign.id, name });
  return campaign;
}

export async function getCampaigns(): Promise<Campaign[]> {
  return await db.select().from(schema.coldCallingCampaigns);
}

export async function getCampaign(id: string): Promise<Campaign | undefined> {
  const [campaign] = await db
    .select()
    .from(schema.coldCallingCampaigns)
    .where(eq(schema.coldCallingCampaigns.id, id));
  return campaign;
}

export async function updateCampaign(
  id: string,
  updates: Partial<Campaign>
): Promise<Campaign | undefined> {
  const [updated] = await db
    .update(schema.coldCallingCampaigns)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(schema.coldCallingCampaigns.id, id))
    .returning();

  logger.info("Campaign updated", { campaignId: id });
  return updated;
}

// Prospect operations
export async function createProspect(
  prospectData: Omit<Prospect, "id" | "createdAt" | "updatedAt">
): Promise<Prospect> {
  const [prospect] = await db
    .insert(schema.coldCallingProspects)
    .values({
      ...prospectData,
      status: "new",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning();

  logger.info("Prospect created", {
    prospectId: prospect.id,
    businessName: prospect.businessName,
  });
  return prospect;
}

export async function getProspects(
  campaignId?: string,
  status?: string
): Promise<Prospect[]> {
  let query = db.select().from(schema.coldCallingProspects);

  if (campaignId) {
    query = query.where(eq(schema.coldCallingProspects.campaignId, campaignId));
  }

  if (status) {
    query = query.where(eq(schema.coldCallingProspects.status, status as any));
  }

  return await query.limit(100);
}

export async function getProspect(id: string): Promise<Prospect | undefined> {
  const [prospect] = await db
    .select()
    .from(schema.coldCallingProspects)
    .where(eq(schema.coldCallingProspects.id, id));
  return prospect;
}

export async function updateProspect(
  id: string,
  updates: Partial<Prospect>
): Promise<Prospect | undefined> {
  const [updated] = await db
    .update(schema.coldCallingProspects)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(schema.coldCallingProspects.id, id))
    .returning();

  logger.info("Prospect updated", { prospectId: id, updates });
  return updated;
}

export async function updateProspectStatus(
  id: string,
  status: Prospect["status"]
): Promise<Prospect | undefined> {
  const [updated] = await db
    .update(schema.coldCallingProspects)
    .set({
      status,
      updatedAt: new Date().toISOString(),
      lastContactedAt:
        status === "contacted" ? new Date().toISOString() : undefined,
    })
    .where(eq(schema.coldCallingProspects.id, id))
    .returning();

  logger.info("Prospect status updated", { prospectId: id, status });
  return updated;
}

// Message operations
export async function createMessage(
  messageData: Omit<Message, "id" | "createdAt">
): Promise<Message> {
  const [message] = await db
    .insert(schema.coldCallingMessages)
    .values({
      ...messageData,
      createdAt: new Date().toISOString(),
    })
    .returning();

  logger.info("Message created", {
    messageId: message.id,
    direction: message.direction,
  });
  return message;
}

export async function getMessages(
  prospectId?: string,
  campaignId?: string,
  limit: number = 100
): Promise<Message[]> {
  let query = db.select().from(schema.coldCallingMessages);

  if (prospectId) {
    query = query.where(eq(schema.coldCallingMessages.prospectId, prospectId));
  }

  if (campaignId) {
    query = query.where(eq(schema.coldCallingMessages.campaignId, campaignId));
  }

  return await query
    .orderBy(desc(schema.coldCallingMessages.createdAt))
    .limit(limit);
}

export async function getMessage(id: string): Promise<Message | undefined> {
  const [message] = await db
    .select()
    .from(schema.coldCallingMessages)
    .where(eq(schema.coldCallingMessages.id, id));
  return message;
}

export async function updateMessageStatus(
  id: string,
  status: Message["status"],
  errorMessage?: string
): Promise<Message | undefined> {
  const updates: Partial<Message> = {
    status,
    ...(errorMessage && { errorMessage }),
  };

  const [updated] = await db
    .update(schema.coldCallingMessages)
    .set(updates)
    .where(eq(schema.coldCallingMessages.id, id))
    .returning();

  logger.info("Message status updated", { messageId: id, status });
  return updated;
}

// Research job operations
export async function createResearchJob(
  searchQuery: string,
  location?: string,
  industry?: string,
  campaignId?: string
): Promise<ResearchJob> {
  const [job] = await db
    .insert(schema.coldCallingResearchJobs)
    .values({
      searchQuery,
      location,
      industry,
      campaignId,
      status: "pending",
      resultsCount: 0,
    })
    .returning();

  logger.info("Research job created", { jobId: job.id, searchQuery });
  return job;
}

export async function getResearchJobs(
  campaignId?: string,
  status?: string
): Promise<ResearchJob[]> {
  let query = db.select().from(schema.coldCallingResearchJobs);

  if (campaignId) {
    query = query.where(eq(schema.coldCallingResearchJobs.campaignId, campaignId));
  }

  if (status) {
    query = query.where(eq(schema.coldCallingResearchJobs.status, status as any));
  }

  return await query.limit(50);
}

export async function updateResearchJob(
  id: string,
  updates: Partial<ResearchJob>
): Promise<ResearchJob | undefined> {
  const [updated] = await db
    .update(schema.coldCallingResearchJobs)
    .set(updates)
    .where(eq(schema.coldCallingResearchJobs.id, id))
    .returning();

  logger.info("Research job updated", { jobId: id, updates });
  return updated;
}

// Automation settings operations
export async function getAutomationSetting(
  key: string
): Promise<AutomationSetting | undefined> {
  const [setting] = await db
    .select()
    .from(schema.coldCallingAutomationSettings)
    .where(eq(schema.coldCallingAutomationSettings.key, key));
  return setting;
}

export async function getAllAutomationSettings(): Promise<AutomationSetting[]> {
  return await db.select().from(schema.coldCallingAutomationSettings);
}

export async function updateAutomationSetting(
  key: string,
  value: string
): Promise<AutomationSetting | undefined> {
  const [updated] = await db
    .update(schema.coldCallingAutomationSettings)
    .set({
      value,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.coldCallingAutomationSettings.key, key))
    .returning();

  logger.info("Automation setting updated", { key, value });
  return updated;
}

// Stats and analytics
export async function getStats(): Promise<{
  totalCampaigns: number;
  totalProspects: number;
  totalMessages: number;
  contactedToday: number;
  interestedProspects: number;
}> {
  const campaigns = await db.select().from(schema.coldCallingCampaigns);
  const prospects = await db.select().from(schema.coldCallingProspects);
  const messages = await db.select().from(schema.coldCallingMessages);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const contactedToday = messages.filter((m: any) => {
    if (m.sentAt) {
      const sentDate = new Date(m.sentAt);
      sentDate.setHours(0, 0, 0, 0);
      return sentDate.getTime() === today.getTime();
    }
    return false;
  }).length;

  const interestedProspects = prospects.filter(
    (p: any) => p.status === "interested"
  ).length;

  return {
    totalCampaigns: campaigns.length,
    totalProspects: prospects.length,
    totalMessages: messages.length,
    contactedToday,
    interestedProspects,
  };
}