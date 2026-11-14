import axios, { AxiosInstance } from "axios";
import { Config } from "../config";
import { logger } from "../logger";

export interface WhatsAppTemplate {
  name: string;
  language: string;
  components: Array<{
    type: string;
    parameters?: Array<{ type: string; text: string }>;
  }>;
}

export interface WhatsAppMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "text" | "template";
  text?: { body: string };
  template?: WhatsAppTemplate;
}

export interface WhatsAppStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipient_id: string;
  timestamp: string;
}

export class WhatsAppService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: Config.WHATSAPP.baseURL,
      headers: Config.WHATSAPP.headers,
      timeout: 30000,
    });

    // Log all requests
    this.client.interceptors.request.use((request) => {
      logger.info("WhatsApp API request", {
        method: request.method,
        url: request.url,
        data: request.data,
      });
      return request;
    });

    // Log all responses
    this.client.interceptors.response.use(
      (response) => {
        logger.info("WhatsApp API response", {
          status: response.status,
          data: response.data,
        });
        return response;
      },
      (error) => {
        logger.error("WhatsApp API error", {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  // Send a text message
  async sendTextMessage(to: string, text: string): Promise<{ id: string }> {
    const message: WhatsAppMessage = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };

    try {
      const response = await this.client.post(
        `/${Config.WHATSAPP.PHONE_NUMBER_ID}/messages`,
        message
      );
      return { id: response.data.messages[0].id };
    } catch (error: any) {
      logger.error("Failed to send WhatsApp text message", {
        to,
        text,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  // Send a template message
  async sendTemplateMessage(
    to: string,
    template: WhatsAppTemplate
  ): Promise<{ id: string }> {
    const message: WhatsAppMessage = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template,
    };

    try {
      const response = await this.client.post(
        `/${Config.WHATSAPP.PHONE_NUMBER_ID}/messages`,
        message
      );
      return { id: response.data.messages[0].id };
    } catch (error: any) {
      logger.error("Failed to send WhatsApp template message", {
        to,
        template: template.name,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  // Mark message as read
  async markAsRead(messageId: string): Promise<void> {
    try {
      await this.client.post(
        `/${Config.WHATSAPP.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }
      );
      logger.info("Marked WhatsApp message as read", { messageId });
    } catch (error: any) {
      logger.error("Failed to mark WhatsApp message as read", {
        messageId,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  // Verify webhook (for receiving messages)
  verifyWebhook(
    mode: string,
    token: string,
    challenge: string
  ): string | null {
    if (mode === "subscribe" && token === Config.WHATSAPP.ACCESS_TOKEN) {
      return challenge;
    }
    return null;
  }

  // Get business profile
  async getBusinessProfile(): Promise<any> {
    try {
      const response = await this.client.get(
        `/${Config.WHATSAPP.PHONE_NUMBER_ID}`
      );
      return response.data;
    } catch (error: any) {
      logger.error("Failed to get WhatsApp business profile", {
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }
}

export default WhatsAppService;