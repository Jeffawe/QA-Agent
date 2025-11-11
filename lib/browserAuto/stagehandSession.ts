import { ObserveResult, Page, Stagehand } from "@browserbasehq/stagehand";
import { Session } from "../utility/abstract.js";
import fs from 'fs';
import path from 'path';
import { State } from "../types.js";
import { eventBusManager } from "../services/events/eventBus.js";
import { getApiKeyForAgent } from "../services/memory/apiMemory.js";
import { dataMemory } from "../services/memory/dataMemory.js";

export default class StagehandSession extends Session<Page> {
    public stagehand: Stagehand | null;
    private apiKey: string;
    private contexts = new Map();

    constructor(sessionId: string) {
        super(sessionId);

        const key = getApiKeyForAgent(sessionId);

        try {
            if (!key || key.startsWith('TEST')) {
                const errorMessage = "API_KEY environment variable is not set or is a test key. Please set a valid API key.";
                this.logManager.error(errorMessage, State.ERROR, true)
                const eventBus = eventBusManager.getBusIfExists();
                eventBus?.emit({
                    ts: Date.now(),
                    type: "stop",
                    sessionId: sessionId,
                    message: errorMessage
                });
                throw new Error(errorMessage);
            }

            console.log('NODE_ENV:', process.env.NODE_ENV);
            const isDevelopment = process.env.NODE_ENV === 'development';
            const isheadless = process.env.HEADLESS === 'true' || process.env.HEADLESS === '1' || false;
            const headless = isDevelopment ? isheadless : true;
            console.log(`🌐 Initializing Stagehand (headless=${headless}) for session ${sessionId}...`);
            this.apiKey = key;
            this.stagehand = new Stagehand({
                env: "LOCAL",
                modelName: "gemini-2.0-flash",
                modelClientOptions: {
                    apiKey: this.apiKey,
                },
                localBrowserLaunchOptions: {
                    headless: headless,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',

                        // Memory reduction flags
                        '--memory-pressure-off',
                        '--max_old_space_size=512',
                        '--aggressive-cache-discard',
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-ipc-flooding-protection',
                        '--disable-background-networking',
                        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                        '--disable-extensions',
                        '--disable-plugins',

                        // Reduce tab/process limits
                        '--renderer-process-limit=1',
                        '--max-gum-fps=5',

                        // Disable GPU acceleration (saves GPU memory)
                        '--disable-gpu',
                        '--disable-software-rasterizer',

                        // Reduce cache sizes
                        '--disk-cache-size=1',
                        '--media-cache-size=1',
                        '--aggressive-cache-discard'
                    ]
                }
            });
        } catch (error) {
            this.logManager.error('Failed to initialize Stagehand. It may be due to an invalid API key. Please check your API key.', State.ERROR, true);
            console.error(`Failed to initialize Stagehand: ${(error as Error).message}`);
            this.stagehand = null;
            throw new Error('Failed to initialize Stagehand. It may be due to an invalid API key. Please check your API key.');
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
            this.baseUrl = url;

            this.page = this.stagehand?.page ?? null;

            if (!this.page) {
                throw new Error("Failed to initialize Stagehand page");
            }

            await this.page.goto(url, {
                timeout: 50000, // 90 seconds instead of 30
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

        this.closeAllContexts();
        await new Promise(r => setTimeout(r, 1000)); // Longer delay
    }

    public async observe(agentId?: string): Promise<ObserveResult[]> {
        if (!this.page) {
            throw new Error("Page not initialized");
        }

        const pageToUse: Page = agentId ? await this.getPage(agentId) : this.page;

        const observations = await pageToUse.observe();
        return observations;
    }

    /**
     * Returns information about the current page.
     * @returns {Promise<{title: string, url: string, contentSummary: string}>} 
     *     A promise that resolves to an object containing the current page's title, URL, and content summary.
     */
    async getCurrentPageInfo(agentId?: string): Promise<{ title: string, url: string, contentSummary: string }> {
        const pageToUse: Page | null = agentId ? await this.getPage(agentId) : this.page;

        if (!pageToUse) {
            throw new Error("Page not initialized");
        }

        return {
            title: await pageToUse.title(),
            url: pageToUse.url(),
            contentSummary: await this.getPageContentSummary(pageToUse)
        };
    }

    async getPageContentSummary(page: Page): Promise<string> {
        try {
            // Get visible text content
            const textContent = await page.evaluate(() => {
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

    /**
     * Takes a full-page screenshot of the current page.
     * @param {string} folderName - The folder name where the screenshot should be saved.
     * @param {string} basicFilename - The basic filename (without extension) of the screenshot.
     * @param {string} [agentId] - The agentId to get the page for. If null or empty, it uses the shared page.
     * @returns {Promise<string | null>} - A promise that resolves to the absolute path of the screenshot file if successful, or null if an error occurs.
     * @throws {Error} - If the page is not initialized, or the screenshot file was not created.
     */
    async takeScreenshot(
        folderName: string,
        basicFilename: string,
        agentId?: string
    ): Promise<string | null> { // Return the actual path instead of boolean
        try {
            const pageToUse: Page | null = agentId ? await this.getPage(agentId) : this.page;

            if (!pageToUse) {
                throw new Error("Page not initialized");
            }

            // Convert to absolute path
            const absoluteFolderPath = path.resolve(folderName);

            if (!fs.existsSync(absoluteFolderPath)) {
                fs.mkdirSync(absoluteFolderPath, { recursive: true });
            }

            const filename = path.join(absoluteFolderPath, `${basicFilename}_desktop`);

            try {
                // Wait for network to be mostly idle (but not too long)
                await pageToUse.waitForLoadState('networkidle', { timeout: 5000 });
            } catch {
                // If networkidle times out, continue anyway
                console.log('Network idle timeout, proceeding with screenshot');
            }

            // 🔑 One-liner: full-page screenshot
            await pageToUse.screenshot({
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

    /**
 * Takes screenshots of the current page for Web, Mobile, and Desktop viewports.
 * @param {string} folderName - The folder name where the screenshots should be saved.
 * @param {string} basicFilename - The basic filename (without extension) of the screenshots.
 * @param {string} [agentId] - The agentId to get the page for. If null or empty, it uses the shared page.
 * @returns {Promise<string[]>} - A promise that resolves to an array of absolute paths for the three screenshots [web, mobile, desktop], or empty array if error occurs.
 * @throws {Error} - If the page is not initialized.
 */
    async takeMultiDeviceScreenshots(
        folderName: string,
        basicFilename: string,
        agentId?: string
    ): Promise<string[]> {
        try {
            const pageToUse: Page | null = agentId ? await this.getPage(agentId) : this.page;

            if (!pageToUse) {
                throw new Error("Page not initialized");
            }

            // Convert to absolute path
            const absoluteFolderPath = path.resolve(folderName);

            if (!fs.existsSync(absoluteFolderPath)) {
                fs.mkdirSync(absoluteFolderPath, { recursive: true });
            }

            // Define viewport configurations
            const crossPlatform = dataMemory.getData('crossPlatform') as boolean;
            const viewports = crossPlatform ? {
                tablet: { width: 1024, height: 768 },      // Tablet/small laptop
                mobile: { width: 375, height: 812 },    // iPhone X/11/12/13 size
                desktop: { width: 1920, height: 1080 }  // Full HD desktop
            } : { 
                desktop: { width: 1920, height: 1080 }  // Full HD desktop
            };

            const screenshotPaths: string[] = [];
            const baseNameWithoutExt = basicFilename.replace(/\.png$/, '');

            // Take screenshot for each viewport
            for (const [device, viewport] of Object.entries(viewports)) {
                try {
                    // Set viewport size
                    await pageToUse.setViewportSize(viewport);

                    // Wait a bit for the page to adjust to new viewport
                    await pageToUse.waitForTimeout(500);

                    // Wait for network to be mostly idle (but not too long)
                    try {
                        await pageToUse.waitForLoadState('networkidle', { timeout: 3000 });
                    } catch {
                        console.log(`Network idle timeout for ${device}, proceeding with screenshot`);
                    }

                    // Create filename with device suffix
                    const filename = path.join(absoluteFolderPath, `${baseNameWithoutExt}_${device}.png`);

                    // Take full-page screenshot
                    await pageToUse.screenshot({
                        path: filename as `${string}.png`,
                        fullPage: true,
                        type: "png",
                    });

                    console.log(`Screenshot saved as ${filename}`);

                    // Verify the file was actually created
                    if (!fs.existsSync(filename)) {
                        throw new Error(`Screenshot file was not created: ${filename}`);
                    }

                    screenshotPaths.push(filename);
                } catch (error) {
                    console.error(`Error taking ${device} screenshot:`, error);
                    continue;
                }
            }

            // Reset to default viewport (desktop) after taking all screenshots
            await pageToUse.setViewportSize(viewports.desktop);

            return screenshotPaths;
        } catch (error) {
            console.error("Error taking multi-device screenshots:", error);
            return [];
        }
    }

    public async runTestScript(): Promise<void> {
        try {
            if (!this.page) throw new Error('Page not initialized');

            this.takeScreenshot('./images', 'screenshot_0.png');

            const observations = await this.observe();
            console.log('Observations:', observations);

            const summary = await this.getPageContentSummary(this.page);
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

    public async act(action: string, agentId?: string): Promise<void> {
        if (!this.page) {
            throw new Error("Page not initialized");
        }

        const pageToUse: Page = agentId ? await this.getPage(agentId) : this.page;

        // Example action: Click at a specific position
        await pageToUse.act(action);
    }

    /**
     * Gets a Page object for the given agentId.
     * If the agentId is null or empty, returns the default Page object.
     * If the agentId is not found in the contexts map, creates a new isolated browser context and page for the agentId.
     * @param agentId - the agentId to get the Page object for
     * @returns a Promise that resolves to the Page object for the given agentId
     */
    async getPage(agentId?: string): Promise<Page> {
        if (!this.stagehand) throw new Error("Stagehand not initialized");

        if (agentId == null || !agentId) {
            return this.stagehand.page;
        }

        // Reuse existing context if already created
        if (this.contexts.has(agentId)) {
            return this.contexts.get(agentId).page;
        }

        // 🔥 Create new isolated browser context + page
        this.logManager.log(`Creating new context for agentId: ${agentId}`, State.INFO);
        const context = this.stagehand.context;
        const page = await context.newPage();
        await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
        this.contexts.set(agentId, { context, page });
        return page;
    }

    async closeAgentContext(agentId: string) {
        try {
            const ctx = this.contexts.get(agentId);
            if (ctx) {
                await ctx.page.close();
                await ctx.context.close();
                this.contexts.delete(agentId);
            }
        } catch (error) {
            console.error("Error closing context:", error);
        }
    }

    async closeAllContexts() {
        try {
            for (const [agentId, ctx] of this.contexts) {
                await ctx.page.close();
                await ctx.context.close();
            }
            this.contexts.clear();
        } catch (error) {
            console.error("Error closing contexts:", error);
        }
    }
}