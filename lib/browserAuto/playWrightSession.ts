import { Browser, Page, Frame, BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';
import { ClicKType, Rect, State } from '../types.js';
import { Session } from '../utility/abstract.js';
import { getBrowser } from './browserManager.js';

export default class PlaywrightSession extends Session<Page> {
  private browser: Browser | null = null;
  public rect: Rect | null = null;
  public frame: Frame | null = null;
  private contexts = new Map();
  private defaultContext: BrowserContext | null = null;

  async start(url: string): Promise<boolean> {
    try {
      const browser = await getBrowser();
      this.browser = browser;
      this.defaultContext = await browser.newContext();
      this.page = await this.defaultContext.newPage();
      if (!this.page) throw new Error("Page not initialized");
      await this.page.goto(url, { waitUntil: 'networkidle' });
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  /**
   * Gets the page for a given agentId.
   * If the agentId is null or empty, it returns the shared page.
   * If the agentId is associated with an existing context, it returns the page associated with that context.
   * If the agentId is not associated with an existing context, it creates a new isolated browser context and page, and returns the new page.
   * @param {string} agentId - The agentId to get the page for.
   * @returns {Promise<Page>} - A promise that resolves to the page associated with the agentId.
   * @throws {Error} - If the Stagehand is not initialized, the page is not initialized, or the default context is not initialized.
   */
  async getPage(agentId?: string): Promise<Page> {
    if (!this.browser) throw new Error("Stagehand not initialized");
    if (!this.page) throw new Error("Page not initialized");
    if (!this.defaultContext) throw new Error("Default context not initialized");

    if (agentId == null || !agentId) {
      return this.page;
    }

    // Reuse existing context if already created
    if (this.contexts.has(agentId)) {
      return this.contexts.get(agentId).page;
    }

    // 🔥 Create new isolated browser context + page
    this.logManager.log(`Creating new context for agentId: ${agentId}`, State.INFO);
    const context = this.defaultContext;
    const page = await context.newPage();
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

  async takeScreenshot(folderName: string, basicFilename: string, agentId?: string): Promise<boolean> {
    try {
      const pageToUse: Page | null = agentId ? await this.getPage(agentId) : this.page;

      if (!pageToUse) {
        throw new Error("Page not initialized");
      }

      if (!fs.existsSync(folderName)) {
        fs.mkdirSync(folderName, { recursive: true });
      }

      const filename = path.join(folderName, basicFilename);

      if (!this.page) throw new Error("Page not initialized");

      // Try waiting for fonts but fallback after 2s
      try {
        await pageToUse.evaluate(async () => {
          await Promise.race([
            document.fonts.ready,
            new Promise((resolve) => setTimeout(resolve, 2000)) // max wait 2s
          ]);
        });
      } catch {
        console.log("Font wait skipped (timeout)");
      }

      // Small buffer wait to let rendering stabilize
      await pageToUse.waitForTimeout(500);

      await pageToUse.screenshot({
        path: filename,
        fullPage: true,
        timeout: 30000
      });

      console.log(`Screenshot saved as ${filename}`);
      return true;
    } catch (error) {
      console.error("Error taking screenshot:", error);
      return false;
    }
  }

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

  async pressKey(key: string): Promise<void> {
    try {
      if (!this.page) throw new Error('Page not initialized');
      await this.page.keyboard.press(key);
      console.log(`Pressed ${key} Key`);
    } catch (error) {
      console.error(`Error pressing Key ${key}:`, error);
    }
  }

  async typeText(text: string): Promise<void> {
    try {
      if (!this.page) throw new Error('Page not initialized');
      await this.page.keyboard.type(text);
      console.log(`Typed text: ${text}`);
    } catch (error) {
      console.error('Error typing text:', error);
    }
  }

  async pressSelector(selector: string, options?: { timeout?: number; waitForSelector?: boolean; scrollIntoView?: boolean; force?: boolean }): Promise<void> {
    try {
      if (!this.page) throw new Error('Page not initialized');
      const { timeout = 5000, waitForSelector = true, scrollIntoView = true } = options || {};

      if (waitForSelector) {
        await this.page.waitForSelector(selector, { timeout });
      }

      if (scrollIntoView) {
        await this.page.$eval(selector, el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      }

      await this.page.click(selector);
    } catch (error) {
      this.logManager.error(`Error pressing selector "${selector}": ${error}`, State.ACT);
      throw error;
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

  async moveMouseTo(x: number, y: number): Promise<void> {
    try {
      if (!this.page) throw new Error('Page not initialized');
      await this.page.mouse.move(x, y);
      console.log(`Moved mouse to (${x}, ${y})`);
    } catch (error) {
      console.error('Error moving mouse:', error);
    }
  }

  async showClickPoint(x: number, y: number, clickType: ClicKType = ClicKType.BOTH, duration = 5000) {
    const showInContext = async (frame: Page | Frame | null, color: string) => {
      if (!frame) return;
      await frame.evaluate(({ x, y, duration, color }) => {
        const indicator = document.createElement('div');
        indicator.style.position = 'fixed';
        indicator.style.left = `${x - 15}px`;
        indicator.style.top = `${y - 15}px`;
        indicator.style.width = '30px';
        indicator.style.height = '30px';
        indicator.style.borderRadius = '50%';
        indicator.style.backgroundColor = color;
        indicator.style.border = '3px solid white';
        indicator.style.zIndex = '9999';
        indicator.style.pointerEvents = 'none';
        indicator.style.opacity = '0.8';
        indicator.className = 'playwright-click-indicator';
        document.body.appendChild(indicator);
        setTimeout(() => indicator.remove(), duration);
      }, { x, y, duration, color });
    };

    if (clickType === ClicKType.PAGE || clickType === ClicKType.BOTH) {
      await showInContext(this.page, 'red');
    }

    if ((clickType === ClicKType.FRAME || clickType === ClicKType.BOTH) && this.frame && this.rect) {
      const frameX = x - this.rect.x;
      const frameY = y - this.rect.y;
      await showInContext(this.frame, 'blue');
    }
  }

  async clearAllClickPoints(agentId?: string) {
    const pageToUse: Page | null = agentId ? await this.getPage(agentId) : this.page;

    if (!pageToUse) return;

    const clearFromContext = async (context: Page | Frame | null) => {
      if (!context) return;
      await context.evaluate(() => {
        document.querySelectorAll('.playwright-click-indicator').forEach(el => el.remove());
      });
    };

    await clearFromContext(pageToUse);
    await clearFromContext(this.frame);
  }

  async close(): Promise<void> {
    this.logManager.log(`Closing session ${this.sessionId}...`);
    const errors: Error[] = [];

    try { await this.clearAllClickPoints(); } catch (e) { errors.push(e as Error); }
    this.frame = null;

    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
    } catch (e) { errors.push(e as Error); this.page = null; }

    try {
      if (this.defaultContext) {
        await this.defaultContext.close(); // closes only this session’s context
        this.defaultContext = null;
      }
    } catch (e) { errors.push(e as Error); this.browser = null; }

    this.rect = null;
    this.logManager.log(`Session ${this.sessionId} cleanup completed`);
    this.closeAllContexts();

    if (errors.length > 0) {
      console.warn(`Session ${this.sessionId} cleanup completed with ${errors.length} warnings:`, errors);
    }
  }
}

export async function runTestSession(url: string): Promise<void> {
  const session = new PlaywrightSession("3");

  console.log('Calling session.start...');
  const newSessionStarted = await session.start(url);
  console.log('session.start completed, result:', newSessionStarted);

  if (!newSessionStarted) {
    console.error('Failed to start test session');
    return;
  }

  const localX = 424 + 100;
  const localY = 492 + 85;

  console.log(`Clicking at local coordinates (${localX}, ${localY}) relative to the game canvas`);
  console.log(`Canvas rect:`, session.rect);

  await session.showClickPoint(localX, localY, ClicKType.BOTH, 10000);
  await new Promise(resolve => setTimeout(resolve, 2000));
  await session.moveMouseTo(localX, localY);
  await session.click(localX, localY);
}
