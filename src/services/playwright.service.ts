import { ChromiumBrowser, chromium, Page, Browser } from "playwright";
import { Config } from "../config";
import { logger } from "../logger";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export interface ScreenshotResult {
  filePath: string;
  websiteUrl: string;
  title?: string;
  error?: string;
}

export class PlaywrightService {
  private browser: Browser | null = null;

  constructor() {
    // Ensure screenshots directory exists
    const screenshotsDir = "./data/screenshots";
    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    try {
      logger.info("Initializing Playwright browser");
      this.browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      logger.info("Playwright browser initialized");
    } catch (error) {
      logger.error("Failed to initialize Playwright browser", { error });
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info("Playwright browser closed");
    }
  }

  // Capture website screenshot
  async captureWebsiteScreenshot(
    url: string,
    options: {
      fullPage?: boolean;
      width?: number;
      height?: number;
      timeout?: number;
      waitForSelector?: string;
    } = {}
  ): Promise<ScreenshotResult> {
    if (!this.browser) {
      await this.initialize();
    }

    const {
      fullPage = true,
      width = 1280,
      height = 720,
      timeout = 30000,
      waitForSelector,
    } = options;

    let page: Page | null = null;
    const screenshotId = `screenshot_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 8)}`;
    const screenshotPath = join(
      "./data/screenshots",
      `${screenshotId}.png`
    );

    try {
      logger.info("Capturing website screenshot", {
        url,
        fullPage,
        width,
        height,
      });

      page = await this.browser!.newPage();
      await page.setViewportSize({ width, height });

      // Set a realistic user agent
      await page.setExtraHTTPHeaders({
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });

      // Navigate to URL with timeout
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
        referer: "https://www.google.com/",
      });

      if (!response || !response.ok()) {
        throw new Error(`Failed to load page: ${response?.status()}`);
      }

      // Wait for specific selector if provided
      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 5000 });
      }

      // Wait for any animations to complete
      await page.waitForTimeout(2000);

      // Capture screenshot
      await page.screenshot({
        path: screenshotPath,
        fullPage,
        type: "png",
      });

      const title = await page.title();

      logger.info("Website screenshot captured", {
        url,
        screenshotPath,
        title,
      });

      return {
        filePath: screenshotPath,
        websiteUrl: url,
        title,
      };
    } catch (error: any) {
      logger.error("Failed to capture website screenshot", {
        url,
        error: error.message,
      });

      return {
        filePath: "",
        websiteUrl: url,
        error: error.message,
      };
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  // Capture multiple website screenshots
  async captureMultipleScreenshots(
    urls: string[],
    options: {
      fullPage?: boolean;
      width?: number;
      height?: number;
      delayBetweenCaptures?: number;
    } = {}
  ): Promise<ScreenshotResult[]> {
    const {
      fullPage = true,
      width = 1280,
      height = 720,
      delayBetweenCaptures = 1000,
    } = options;

    const results: ScreenshotResult[] = [];

    for (const url of urls) {
      const result = await this.captureWebsiteScreenshot(url, {
        fullPage,
        width,
        height,
      });
      results.push(result);

      if (delayBetweenCaptures > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenCaptures));
      }
    }

    return results;
  }

  // Verify if website is accessible and get basic info
  async verifyWebsite(
    url: string
  ): Promise<{
    accessible: boolean;
    statusCode?: number;
    title?: string;
    loadTime?: number;
    error?: string;
  }> {
    if (!this.browser) {
      await this.initialize();
    }

    let page: Page | null = null;
    const startTime = Date.now();

    try {
      page = await this.browser!.newPage();

      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      const loadTime = Date.now() - startTime;
      const title = await page.title();

      return {
        accessible: true,
        statusCode: response?.status(),
        title,
        loadTime,
      };
    } catch (error: any) {
      return {
        accessible: false,
        error: error.message,
      };
    } finally {
      if (page) {
        await page.close();
      }
    }
  }
}

export default PlaywrightService;