import { ObserveResult, Page, Stagehand } from "@browserbasehq/stagehand";
import { Session } from "../utility/abstract.js";
import fs from 'fs';
import path from 'path';
import { LogManager } from '../utility/logManager.js';
import { State } from "../types.js";
import { eventBus } from "../services/events/eventBus.js";

export default class StagehandSession extends Session<Page> {
    public stagehand: Stagehand | null;

    constructor(sessionId: string) {
        super(sessionId);

        try {
            if (!process.env.API_KEY || process.env.API_KEY.startsWith('TEST')) {
                const errorMessage = "API_KEY environment variable is not set or is a test key. Please set a valid API key.";
                LogManager.error(errorMessage, State.ERROR, true)
                eventBus.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: errorMessage
                });
                throw new Error(errorMessage);
            }

            this.stagehand = new Stagehand({
                env: "LOCAL",
                modelName: "google/gemini-2.5-flash",
                modelClientOptions: {
                    apiKey: process.env.API_KEY,
                },
                localBrowserLaunchOptions: {
                    headless: false
                }
            });
        } catch (error) {
            LogManager.error(`Failed to initialize Stagehand: ${(error as Error).message}`, State.ERROR, true);
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

            await this.page.goto(url);

            return true;
        } catch (error) {
            const err = error as Error;
            LogManager.error(`Failed to start Stagehand session: ${err.message}`);
            return false
        }
    }

    async close(): Promise<void> {
        await this.stagehand?.close();
        await new Promise((r) => setTimeout(r, 500));
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
    ): Promise<boolean> {
        try {
            if (!fs.existsSync(folderName)) {
                fs.mkdirSync(folderName, { recursive: true });
            }

            const filename = path.join(folderName, basicFilename);
            if (!this.page) throw new Error("Page not initialized");

            // 🔑 One-liner: full-page screenshot
            await this.page.screenshot({
                path: filename as `${string}.png`,
                fullPage: true,          // captures above-the-fold + below-the-fold
                type: "png",
            });

            console.log(`Screenshot saved as ${filename}`);
            return true;
        } catch (error) {
            console.error("Error taking screenshot:", error);
            return false;
        }
    }

    async click(x: number, y: number): Promise<void> {
        try {
            if (!this.page) throw new Error('Page not initialized');
            await this.page.mouse.click(x, y);
            console.log(`Clicked at (${x}, ${y})`);
        } catch (error) {
            console.error('Error clicking:', error);
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