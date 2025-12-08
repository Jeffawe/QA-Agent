import { ObserveResult, Page, Stagehand } from "@browserbasehq/stagehand";
import { Session } from "../utility/abstract.js";
import fs from 'fs';
import path from 'path';
import { State } from "../types.js";
import { eventBusManager } from "../services/events/eventBus.js";
import { getApiKeyForAgent } from "../services/memory/apiMemory.js";
import { dataMemory } from "../services/memory/dataMemory.js";

export interface ActResult{
    success: boolean,
    message: string
}

// 2 seconds max (20 * 100ms)
const MAX_WAIT_ATTEMPTS = 20;

export default class StagehandSession extends Session<Page> {
    public stagehand: Stagehand | null;
    private apiKey: string;
    private contexts = new Map();

    private isNavigating = false;
    private navigationQueue: Array<() => Promise<void>> = [];
    private _currentUrl: string = "";
    private _pendingUrl: string | null = null;

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

            if (this.page) {
                this._currentUrl = this.page.url();
                this._pendingUrl = null;
            }

            return true;
        } catch (error) {
            const err = error as Error;
            this.logManager.error(`Failed to start Stagehand session: ${err.message}`);
            return false
        }
    }

    async close(): Promise<void> {
        try {
            // Wait for any pending navigations to complete before clearing
            this.logManager.log(`Closing StagehandSession. Checking for pending operations...`, State.INFO);

            let waitAttempts = 0;

            while ((this.isNavigating || this.navigationQueue.length > 0) && waitAttempts < MAX_WAIT_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitAttempts++;
            }

            if (waitAttempts >= MAX_WAIT_ATTEMPTS) {
                this.logManager.log(
                    `⚠️ Force closing - some operations may still be pending (queue: ${this.navigationQueue.length})`,
                    State.INFO
                );
            }

            // Now clear any remaining operations
            this.clearNavigationQueue();

            // Close the page first
            if (this.stagehand?.page) {
                await this.stagehand.page.close().catch(err => {
                    this.logManager.log(`Page close error (expected if already closed): ${err.message}`, State.INFO);
                });
            }

            // Then close stagehand
            if (this.stagehand) {
                await this.stagehand.close().catch(err => {
                    this.logManager.log(`Stagehand close error: ${err.message}`, State.INFO);
                });
            }
        } catch (error) {
            console.error('Error during stagehand cleanup:', error);
            this.logManager.error(`Stagehand cleanup error: ${error}`, State.ERROR);
        }

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }

        this.closeAllContexts();
        await new Promise(r => setTimeout(r, 1000)); // Longer delay
    }

    public clearNavigationQueue(): void {
        if (this.navigationQueue.length > 0) {
            this.logManager.log(
                `🧹 Clearing ${this.navigationQueue.length} queued navigation operations`,
                State.INFO
            );
        }
        this.navigationQueue.length = 0;
        this.isNavigating = false;
        this._pendingUrl = null; // Also clear pending URL
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
            const crossPlatform = dataMemory.getData('crossplatform') as boolean || false;
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

    /**
     * Get current URL synchronously - what the browser is showing RIGHT NOW
     * WARNING: May be stale if navigation is queued/in-progress
     * Use for: Logging, display, non-critical operations
     */
    public getCurrentUrl(): string {
        try {
            if (!this.page) {
                throw new Error("Page not initialized");
            }

            return this._currentUrl || this.page.url();
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get the URL we'll be on once all queued operations complete
     * Returns pending URL if navigation is queued, otherwise current URL
     * Use for: Planning next actions, checking future destination
     */
    public getEffectiveUrl(): string {
        return this._pendingUrl || this._currentUrl || this.page?.url() || "";
    }

    /**
     * Wait for all pending navigations to complete, then return current URL
     * This BLOCKS until the navigation queue is empty and no navigation is in progress
     * Use for: Critical operations that require accurate URL (state transitions, validations)
     * @returns Promise<string> The stable, guaranteed-accurate current URL
     */
    public async waitForStableUrl(): Promise<string> {
        // Wait until nothing is navigating and queue is empty
        while (this.isNavigating || this.navigationQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Double-check the page URL matches our tracked URL
        if (this.page) {
            const pageUrl = this.page.url();
            if (pageUrl !== this._currentUrl) {
                this.logManager.log(`URL sync: ${this._currentUrl} -> ${pageUrl}`, State.INFO);
                this._currentUrl = pageUrl;
            }
        }

        return this._currentUrl;
    }


    /**
     * Navigates to a new page and updates the tracked URL.
     * Waits for the page to load (domcontentloaded) and then updates the tracked URL.
     * If the old page is the same as the new page, does nothing.
     * If the old page is different from the new page, logs the navigation.
     * If an error occurs during navigation, logs the error and clears the pending URL.
     * @param newPage The URL of the page to navigate to.
     * @param oldPage The URL of the page before navigation. If this is the same as newPage, does nothing.
     * @returns A promise that resolves when the navigation is complete.
     */
    public async goto(newPage: string, oldPage?: string): Promise<void> {
        // Set pending URL immediately (before queuing)
        this._pendingUrl = newPage;

        return this.queueNavigation(async () => {
            if (!this.page) {
                this._pendingUrl = null;
                throw new Error("Page not initialized");
            }

            if (oldPage && oldPage === newPage) {
                this.logManager.log(`Already on ${newPage}`, State.INFO);
                this._pendingUrl = null;
                return;
            }

            if (oldPage) this.logManager.log(`Navigating: ${oldPage} -> ${newPage}`, State.INFO);

            try {
                await this.page.goto(newPage, {
                    waitUntil: "domcontentloaded",
                    timeout: 30000
                });

                await new Promise(resolve => setTimeout(resolve, 500));

                // Update tracked URL AFTER navigation completes
                this._currentUrl = this.page.url();
                this._pendingUrl = null; // ✅ Clear pending

                this.logManager.log(`Navigation complete: ${this._currentUrl}`, State.INFO);
            } catch (err: any) {
                if (err.message?.includes('ERR_ABORTED') ||
                    err.message?.includes('net::ERR_')) {
                    this._currentUrl = this.page.url();
                    this._pendingUrl = null; // ✅ Clear pending even on error
                    this.logManager.log(`Navigation interrupted, at: ${this._currentUrl}`, State.INFO);
                    return;
                }
                this._pendingUrl = null; // ✅ Clear pending on any error
                throw err;
            }
        });
    }

    /**
     * Executes an action on a page and tracks the success state.
     * This method is intended to be used for executing actions on a page
     * and tracking the success state.
     * If the action causes a navigation, the method will wait until the
     * navigation completes before resolving.
     * @param action The action to execute on the page.
     * @param agentId The agentId to use for the action.
     * @returns A promise that resolves to a boolean indicating whether the
     * action completed successfully.
     */
    public async act(action: string, agentId?: string): Promise<ActResult> {
        const urlBefore = this.getCurrentUrl();

        let success = false; // Track success state
        let message = "";

        await this.queueNavigation(async () => {
            if (!this.page) {
                throw new Error("Page not initialized");
            }

            const pageToUse: Page = agentId ? await this.getPage(agentId) : this.page;
            this.logManager.log(`[ACT] Before: ${urlBefore}, Action: ${action}`, State.INFO);

            try {
                const element = await pageToUse.locator(action).first();
                if (element) {
                    await element.scrollIntoViewIfNeeded().catch(() => { });
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                const result = await pageToUse.act(action);
                this.logManager.log(`[ACT] Result: ${JSON.stringify(result)}`, State.INFO);

                if (result.success == false) {
                    success = false; // ✅ Explicitly set false
                    message = result.message;
                    return;
                }

                // Wait for potential navigation
                await new Promise(resolve => setTimeout(resolve, 1000));
                const urlAfter = pageToUse.url();

                // ✅ Update tracked URL if it changed
                if (urlBefore !== urlAfter) {
                    this._currentUrl = urlAfter;
                    this.logManager.log(`[ACT] URL changed: ${urlBefore} -> ${urlAfter}`, State.INFO);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const urlFinal = pageToUse.url();
                    if (urlFinal !== urlBefore) {
                        this._currentUrl = urlFinal;
                        this.logManager.log(`[ACT] URL changed (delayed): ${urlBefore} -> ${urlFinal}`, State.INFO);
                    }
                }

                success = true; // ✅ Action completed successfully

            } catch (err: any) {
                if (err.message?.includes('ERR_ABORTED') ||
                    err.message?.includes('frame was detached') ||
                    err.message?.includes('Execution context was destroyed') ||
                    err.message?.includes('Target page, context or browser has been closed')) {
                    // ✅ Update URL even after detachment
                    this._currentUrl = this.page?.url() || this._currentUrl;
                    this.logManager.log(`[ACT] Navigation caused detachment, at: ${this._currentUrl}`, State.INFO);
                    success = true; // ✅ Detachment is actually success (navigation happened)
                    return;
                }
                success = false; // ✅ Real error
                message = err.message;
                throw err;
            }
        });

        return { success, message }; // ✅ Return the tracked success state
    }

    /**
     * Queue system to ensure only one navigation/action happens at a time
     */
    private async queueNavigation(operation: () => Promise<void>): Promise<void> {
        // If currently navigating, queue this operation
        if (this.isNavigating) {
            this.logManager.log(`Operation queued (${this.navigationQueue.length} in queue)`, State.INFO);
            return new Promise((resolve, reject) => {
                this.navigationQueue.push(async () => {
                    try {
                        await operation();
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        }

        // Execute immediately
        this.isNavigating = true;
        try {
            await operation();
        } finally {
            this.isNavigating = false;

            // Process next item in queue
            const next = this.navigationQueue.shift();
            if (next) {
                this.logManager.log(`Processing queued operation (${this.navigationQueue.length} remaining)`, State.INFO);
                // Don't await - let it run independently
                next().catch(err => {
                    this.logManager.error(`Queued operation failed: ${err.message}`, State.ERROR);
                });
            }
        }
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