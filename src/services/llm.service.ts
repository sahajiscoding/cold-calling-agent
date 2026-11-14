import { Config } from "../config";
import { logger } from "../logger";

export interface ConversationContext {
  prospectId: string;
  businessName: string;
  history: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }>;
  currentIntent?: string;
  sentiment?: "positive" | "neutral" | "negative";
  followUpNeeded?: boolean;
  nextAction?: string;
}

export interface MessageAnalysis {
  intent: string;
  confidence: number;
  requiresResponse: boolean;
  sentiment: "positive" | "neutral" | "negative";
  keyInformation: string[];
  followUpRequired: boolean;
  responseTemplate?: string;
}

export class LLMService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    // Using a placeholder for LLM service - can be configured for different providers
    this.baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    this.apiKey = process.env.LLM_API_KEY || "";

    if (!this.apiKey) {
      logger.warn("LLM API key not configured - using mock responses");
    }
  }

  // Analyze incoming message from prospect
  async analyzeMessage(
    context: ConversationContext,
    messageText: string
  ): Promise<MessageAnalysis> {
    logger.info("Analyzing message with LLM", {
      prospectId: context.prospectId,
      messageText: messageText.substring(0, 100),
    });

    if (!this.apiKey) {
      // Return mock analysis if no API key
      return this.getMockAnalysis(messageText);
    }

    try {
      // Build conversation context
      const conversationHistory = context.history
        .map((h) => `${h.role}: ${h.content}`)
        .join("\n");

      const prompt = `You are analyzing a message from a business owner who was contacted about their website/online presence.

Context:
- Business: ${context.businessName}
- Previous conversation: ${conversationHistory || "No previous conversation"}

New message: "${messageText}"

Analyze this message and respond in JSON format with:
{
  "intent": "intent classification (interested, not_interested, asking_questions, etc.)",
  "confidence": 0.0-1.0,
  "requiresResponse": boolean,
  "sentiment": "positive/neutral/negative",
  "keyInformation": ["array", "of", "key", "points"],
  "followUpRequired": boolean,
  "responseTemplate": "suggested response template if requiresResponse"
}`;

      // Call LLM API (OpenAI-compatible)
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant analyzing customer messages for a cold calling agent. Respond in JSON format.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = await response.json();
      const analysis = JSON.parse(data.choices[0].message.content);

      logger.info("LLM message analysis completed", {
        prospectId: context.prospectId,
        analysis,
      });

      return analysis;
    } catch (error: any) {
      logger.error("Failed to analyze message with LLM", {
        error: error.message,
        prospectId: context.prospectId,
      });

      // Fallback to mock analysis
      return this.getMockAnalysis(messageText);
    }
  }

  // Generate response to prospect message
  async generateResponse(
    context: ConversationContext,
    analysis: MessageAnalysis
  ): Promise<string> {
    if (!this.apiKey) {
      return this.getTemplateResponse(context, analysis);
    }

    try {
      const prompt = `Generate a friendly, professional response to this message from a business owner.

Context:
- Business: ${context.businessName}
- Message intent: ${analysis.intent}
- Sentiment: ${analysis.sentiment}
- Key information: ${analysis.keyInformation.join(", ")}

Original message context:
${context.history.map((h) => `${h.role}: ${h.content}`).join("\n")}

Generate a response that:
1. Acknowledges their message
2. Addresses their concern or question
3. Moves the conversation forward
4. Is concise and professional

Respond with just the response text, no JSON formatting.`;

      // In a real implementation, this would call the LLM API
      // For now, return a template response
      return this.getTemplateResponse(context, analysis);
    } catch (error: any) {
      logger.error("Failed to generate LLM response", {
        error: error.message,
        prospectId: context.prospectId,
      });

      return this.getTemplateResponse(context, analysis);
    }
  }

  // Check if prospect is interested
  isInterested(analysis: MessageAnalysis): boolean {
    return (
      analysis.sentiment === "positive" &&
      (analysis.intent.includes("interested") ||
        analysis.intent.includes("want") ||
        analysis.intent.includes("yes"))
    );
  }

  // Check if follow-up is needed
  requiresFollowUp(analysis: MessageAnalysis): boolean {
    return (
      analysis.followUpRequired ||
      analysis.intent.includes("later") ||
      analysis.intent.includes("busy")
    );
  }

  // Mock analysis for testing/development
  private getMockAnalysis(messageText: string): MessageAnalysis {
    const lowerText = messageText.toLowerCase();

    let intent = "general";
    let sentiment: "positive" | "neutral" | "negative" = "neutral";
    let requiresResponse = true;
    let followUpRequired = false;

    if (lowerText.includes("interested") || lowerText.includes("yes")) {
      intent = "interested";
      sentiment = "positive";
    } else if (lowerText.includes("not interested") || lowerText.includes("no")) {
      intent = "not_interested";
      sentiment = "negative";
      requiresResponse = false;
    } else if (lowerText.includes("later") || lowerText.includes("busy")) {
      intent = "follow_up";
      sentiment = "neutral";
      followUpRequired = true;
    } else if (lowerText.includes("how") || lowerText.includes("what")) {
      intent = "asking_questions";
      sentiment = "neutral";
    }

    return {
      intent,
      confidence: 0.7,
      requiresResponse,
      sentiment,
      keyInformation: [messageText],
      followUpRequired,
      responseTemplate: this.getTemplateResponse(
        { prospectId: "", businessName: "", history: [] },
        { intent, sentiment, followUpRequired, requiresResponse } as MessageAnalysis
      ),
    };
  }

  // Template responses based on intent
  private getTemplateResponse(
    context: ConversationContext,
    analysis: MessageAnalysis
  ): string {
    const businessName = context.businessName;

    if (analysis.sentiment === "negative") {
      return `Thank you for your time, ${businessName}. We understand you may not be interested at this time. We'll leave you be and wish you all the best with your business.`;
    }

    if (analysis.intent.includes("asking_questions")) {
      return `Great question! We'd be happy to explain more about how our service can help ${businessName}. We help businesses like yours get online presence quickly and affordably. Would you like to schedule a brief call to discuss this further?`;
    }

    if (analysis.intent.includes("interested")) {
      return `Wonderful! We're excited to help ${businessName} get online. Let's schedule a quick 15-minute call to discuss your needs. What's the best time for you? We're available ${Config.AGENT.BUSINESS_HOURS_START} to ${Config.AGENT.BUSINESS_HOURS_END} ${Config.AGENT.TIMEZONE}.`;
    }

    if (analysis.followUpRequired) {
      return `No problem at all, ${businessName}. We understand you're busy. When would be a good time to reconnect? We can work around your schedule.`;
    }

    return `Thank you for your message, ${businessName}. We're here to help you get online presence. Please let us know if you have any questions.`;
  }
}

export default LLMService;