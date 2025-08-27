import { Browser, Page, Frame, BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';
import { ClicKType, Rect, State } from '../types.js';
import { Session } from '../utility/abstract.js';
import { getBrowser } from '../browserManager.js';

export default class PlaywrightSession extends Session<Page> {
  private browser: Browser | null = null;
  public rect: Rect | null = null;
  public frame: Frame | null = null;
  private context: BrowserContext | null = null;

  async start(url: string): Promise<boolean> {
    try {
      const browser = await getBrowser();
      this.context = await browser.newContext();
      this.page = await this.context.newPage();
      await this.page.goto(url, { waitUntil: 'networkidle' });
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  async takeScreenshot(folderName: string, basicFilename: string): Promise<boolean> {
    try {
      if (!fs.existsSync(folderName)) {
        fs.mkdirSync(folderName, { recursive: true });
      }

      const filename = path.join(folderName, basicFilename);

      if (!this.page) throw new Error("Page not initialized");

      try {
        // Wait for network to be mostly idle (but not too long)
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // If networkidle times out, continue anyway
        console.log('Network idle timeout, proceeding with screenshot');
      }

      await this.page.screenshot({ path: filename, fullPage: true });

      console.log(`Screenshot saved as ${filename}`);
      return true;
    } catch (error) {
      console.error("Error taking screenshot:", error);
      return false;
    }
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
      const textContent = await this.page?.evaluate(() => {
        document.querySelectorAll('script, style').forEach(el => el.remove());
        const content = document.body.innerText || document.body.textContent || '';
        return content.replace(/\s+/g, ' ').trim();
      });

      return typeof textContent === 'string'
        ? textContent.substring(0, 500) + (textContent.length > 500 ? '...' : '')
        : '';
    } catch {
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

  async clearAllClickPoints() {
    const clearFromContext = async (context: Page | Frame | null) => {
      if (!context) return;
      await context.evaluate(() => {
        document.querySelectorAll('.playwright-click-indicator').forEach(el => el.remove());
      });
    };

    await clearFromContext(this.page);
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
      if (this.context) {
        await this.context.close(); // closes only this session’s context
        this.context = null;
      }
    } catch (e) { errors.push(e as Error); this.browser = null; }

    this.rect = null;
    this.logManager.log(`Session ${this.sessionId} cleanup completed`);

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
