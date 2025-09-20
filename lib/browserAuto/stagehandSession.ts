import { ObserveResult, Page, Stagehand } from "@browserbasehq/stagehand";
import { Session } from "../utility/abstract.js";
import fs from 'fs';
import path from 'path';
import { State } from "../types.js";
import { eventBusManager } from "../services/events/eventBus.js";
import { getApiKeyForAgent } from "../services/memory/apiMemory.js";

export default class StagehandSession extends Session<Page> {
    public stagehand: Stagehand | null;
    private apiKey: string;

    constructor(sessionId: string) {
        super(sessionId);

        const key = getApiKeyForAgent(sessionId);

        try {
            if (!key || key.startsWith('TEST')) {
                const errorMessage = "API_KEY environment variable is not set or is a test key. Please set a valid API key.";
                this.logManager.error(errorMessage, State.ERROR, true)
                const eventBus = eventBusManager.getBusIfExists(sessionId);
                eventBus?.emit({
                    ts: Date.now(),
                    type: "stop",
                    sessionId: sessionId,
                    message: errorMessage
                });
                throw new Error(errorMessage);
            }

            const isProduction = process.env.NODE_ENV === 'production';
            const headless = isProduction ? true : String(process.env.HEADLESS).toLowerCase() === 'true';
            this.apiKey = key;
            this.stagehand = new Stagehand({
                env: "LOCAL",
                modelName: "google/gemini-2.5-flash",
                modelClientOptions: {
                    apiKey: this.apiKey,
                },
                localBrowserLaunchOptions: {
                    headless: headless,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-features=CalculateNativeWinOcclusion',
                        '--single-process', // Important for containers
                        '--no-zygote', // Helps with permission issues
                        '--disable-extensions',
                        '--disable-web-security'
                    ]
                }
            });
        } catch (error) {
            this.logManager.error(`Failed to initialize Stagehand: ${(error as Error).message}`, State.ERROR, true);
            this.stagehand = null;
            throw new Error(`Failed to initialize Stagehand: ${(error as Error).message}`);
        }
    }

    async start(url: string): Promise<boolean> {
        try {
            if (!url) {
                throw new Error("URL must be provided to start Stagehand session");
            }

            if (!this.stagehand) {
                throw new Error("Stagehand instance is not initialized");
            }

            await this.stagehand?.init();

            this.page = this.stagehand?.page ?? null;

            if (!this.page) {
                throw new Error("Failed to initialize Stagehand page");
            }

            await this.page.goto(url, {
                timeout: 90000, // 90 seconds instead of 30
                waitUntil: 'domcontentloaded' // Less strict than 'load'
            });

            return true;
        } catch (error) {
            const err = error as Error;
            this.logManager.error(`Failed to start Stagehand session: ${err.message}`);
            return false
        }
    }

    async close(): Promise<void> {
        try {
            if (this.stagehand?.page) {
                await this.stagehand.page.close();
            }
            if (this.stagehand) {
                await this.stagehand.close();
            }
        } catch (error) {
            console.error('Error during stagehand cleanup:', error);
        }

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }

        await new Promise(r => setTimeout(r, 1000)); // Longer delay
    }

    public async observe(): Promise<ObserveResult[]> {
        if (!this.page) {
            throw new Error("Page not initialized");
        }

        const observations = await this.page.observe();
        return observations;
    }

    async getCurrentPageInfo() {
        return {
            title: await this.page?.title(),
            url: this.page?.url(),
            contentSummary: await this.getPageContentSummary()
        };
    }

    async getPageContentSummary(): Promise<string> {
        try {
            // Get visible text content
            const textContent = await this.page?.evaluate(() => {
                // Remove script and style elements
                const scripts = document.querySelectorAll('script, style');
                scripts.forEach(el => el.remove());

                // Get text content and clean it up
                const content = document.body.innerText || document.body.textContent || '';
                return content
                    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                    .trim();
            });

            // Truncate to reasonable length (first 500 characters)
            if (typeof textContent === 'string') {
                return textContent.substring(0, 500) + (textContent.length > 500 ? '...' : '');
            } else {
                return '';
            }
        } catch (error) {
            return "Unable to extract page content";
        }
    }

    async takeScreenshot(
        folderName: string,
        basicFilename: string,
    ): Promise<string | null> { // Return the actual path instead of boolean
        try {
            // Convert to absolute path
            const absoluteFolderPath = path.resolve(folderName);

            if (!fs.existsSync(absoluteFolderPath)) {
                fs.mkdirSync(absoluteFolderPath, { recursive: true });
            }

            const filename = path.join(absoluteFolderPath, basicFilename);
            if (!this.page) throw new Error("Page not initialized");

            try {
                // Wait for network to be mostly idle (but not too long)
                await this.page.waitForLoadState('networkidle', { timeout: 5000 });
            } catch {
                // If networkidle times out, continue anyway
                console.log('Network idle timeout, proceeding with screenshot');
            }

            // 🔑 One-liner: full-page screenshot
            await this.page.screenshot({
                path: filename as `${string}.png`,
                fullPage: true,          // captures above-the-fold + below-the-fold
                type: "png",
            });

            console.log(`Screenshot saved as ${filename}`);

            // Verify the file was actually created
            if (!fs.existsSync(filename)) {
                throw new Error(`Screenshot file was not created: ${filename}`);
            }

            return filename; // Return the absolute path
        } catch (error) {
            console.error("Error taking screenshot:", error);
            return null;
        }
    }

    public async runTestScript(): Promise<void> {
        try {
            if (!this.page) throw new Error('Page not initialized');

            this.takeScreenshot('./images', 'screenshot_0.png');

            const observations = await this.observe();
            console.log('Observations:', observations);

            const summary = await this.getPageContentSummary();
            console.log('Page Content Summary:', summary);
        } catch (error) {
            console.error('Error running test script:', error);
            throw error;
        }
    }

    public async testAgent(url: string): Promise<void> {
        if (!this.page) {
            throw new Error("Page not initialized");
        }

        const hasStarted = await this.start(url);
        if (!hasStarted) {
            throw new Error("Failed to start Stagehand session");
        }

        const agent = this.stagehand?.agent({
            provider: "openai",
            model: "computer-use-preview-2025-03-11",
            instructions: "You are a helpful assistant that can use a web browser.",
            options: {
                apiKey: process.env.OPENAI_API_KEY,
            },
        });

        await agent?.execute({
            instruction: "Find the nutritional value of a tomato.",
            maxSteps: 10,
            autoScreenshot: true,
        })
    }

    public async act(action: string): Promise<void> {
        if (!this.page) {
            throw new Error("Page not initialized");
        }

        // Example action: Click at a specific position
        await this.page.act(action);
    }
}