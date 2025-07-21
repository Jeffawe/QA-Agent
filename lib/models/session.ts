import puppeteer, { Browser, Page, KeyInput, Frame } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { ClicKType, Rect, State } from '../types.js';
import { LogManager } from '../utility/logManager.js';

export default class Session {
  private sessionId: string;
  private browser: Browser | null = null;
  public page: Page | null = null;
  public rect: Rect | null = null;
  public frame: Frame | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async start(url: string): Promise<boolean> {
    try {
      // 1. Launch the browser (Chromium)
      // headless: false makes the browser visible so you can watch what's happening
      this.browser = await puppeteer.launch({ headless: false });

      // 2. Open a new browser tab (page)
      this.page = await this.browser.newPage();

      // 3. Go to the itch.io game page
      await this.page.goto(url, { waitUntil: 'networkidle2' });
      // waitUntil: 'networkidle2' waits until no network connections for 500ms - means page mostly loaded

      console.log('Game should be running now!');

      return true;
    } catch (error) {
      console.error(error);
      return false;
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

  async pressKey(key: string): Promise<void> {
    try {
      if (!this.page) throw new Error('Page not initialized');
      await this.page.keyboard.press(key as KeyInput);
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

  async pressSelector(selector: string, options?: {
    timeout?: number;
    waitForSelector?: boolean;
    scrollIntoView?: boolean;
    force?: boolean;
  }): Promise<void> {
    try {
      if (!this.page) throw new Error('Page not initialized');

      const {
        timeout = 5000,
        waitForSelector = true,
        scrollIntoView = true
      } = options || {};

      // Wait for selector to be available if requested
      if (waitForSelector) {
        await this.page.waitForSelector(selector, { timeout });
      }

      // Scroll element into view if requested
      if (scrollIntoView) {
        await this.page.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, selector);
      }

      // Click the element
      await this.page.click(selector);

    } catch (error) {
      LogManager.error(`Error pressing selector "${selector}": ${error}`, State.ACT);
      throw error; // Re-throw to allow caller to handle
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

  async showClickPointOnPage(x: number, y: number, duration: number = 3000) {
    if (!this.page) throw new Error('Page not initialized');

    await this.page.evaluate((x: number, y: number, duration: number) => {
      // Create visual indicator
      const indicator = document.createElement('div');
      indicator.className = 'puppeteer-click-indicator';
      indicator.style.position = 'fixed';
      indicator.style.left = (x - 15) + 'px';
      indicator.style.top = (y - 15) + 'px';
      indicator.style.width = '30px';
      indicator.style.height = '30px';
      indicator.style.borderRadius = '50%';
      indicator.style.backgroundColor = 'red';
      indicator.style.border = '3px solid white';
      indicator.style.zIndex = '9999';
      indicator.style.pointerEvents = 'none';
      indicator.style.opacity = '0.8';

      document.body.appendChild(indicator);

      // Remove after duration
      setTimeout(() => {
        if (indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      }, duration);
    }, x, y, duration);
  }

  // Show click point inside the iframe (convert coordinates)
  async showClickPointInFrame(globalX: number, globalY: number, duration: number = 3000) {
    if (!this.frame || !this.rect) throw new Error('Frame or rect not initialized');

    // Convert global coordinates to iframe-relative coordinates
    const frameX = globalX - this.rect.x;
    const frameY = globalY - this.rect.y;

    await this.frame.evaluate((x: number, y: number, duration: number) => {
      // Create visual indicator
      const indicator = document.createElement('div');
      indicator.className = 'puppeteer-click-indicator';
      indicator.style.position = 'fixed';
      indicator.style.left = (x - 15) + 'px';
      indicator.style.top = (y - 15) + 'px';
      indicator.style.width = '30px';
      indicator.style.height = '30px';
      indicator.style.borderRadius = '50%';
      indicator.style.backgroundColor = 'blue';
      indicator.style.border = '3px solid yellow';
      indicator.style.zIndex = '9999';
      indicator.style.pointerEvents = 'none';
      indicator.style.opacity = '0.8';

      document.body.appendChild(indicator);

      // Remove after duration
      setTimeout(() => {
        if (indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      }, duration);
    }, frameX, frameY, duration);
  }

  // Combined method to show indicators both on page and in frame
  async showClickPoint(x: number, y: number, clickType: ClicKType = ClicKType.BOTH, duration: number = 50000) {
    if (clickType === ClicKType.PAGE) {
      await this.showClickPointOnPage(x, y, duration);
    }

    if (clickType === ClicKType.FRAME) {
      await this.showClickPointInFrame(x, y, duration);
    }

    if (clickType === ClicKType.BOTH) {
      await this.showClickPointOnPage(x, y, duration);
      await this.showClickPointInFrame(x, y, duration);
    }
  }

  async clearAllClickPoints() {
    try {
      // Clear indicators on the main page
      if (this.page) {
        await this.page.evaluate(`
          (function() {
            var indicators = document.querySelectorAll('.puppeteer-click-indicator');
            for (var i = 0; i < indicators.length; i++) {
              if (indicators[i].parentNode) {
                indicators[i].parentNode.removeChild(indicators[i]);
              }
            }
          })();
      `);
      }

      // Clear indicators inside the iframe
      if (this.frame) {
        await this.frame.evaluate(`
          (function() {
            var indicators = document.querySelectorAll('.puppeteer-click-indicator');
            for (var i = 0; i < indicators.length; i++) {
              if (indicators[i].parentNode) {
                indicators[i].parentNode.removeChild(indicators[i]);
              }
            }
          })();
      `);
      }
    }
    catch (error) {
      console.error('Error clearing click indicators:', error);
    }
  }

  async close(): Promise<void> {
    LogManager.log(`Closing session ${this.sessionId}...`);

    const errors: Error[] = [];

    try {
      // Clear any visual click indicators first
      await this.clearAllClickPoints();
    } catch (error) {
      console.warn('Warning: Failed to clear click indicators:', error);
      errors.push(error as Error);
    }

    // Clean up frame reference
    if (this.frame) {
      try {
        // The frame will be cleaned up when the page closes, but we can null the reference
        this.frame = null;
        LogManager.log('Frame reference cleared');
      } catch (error) {
        console.warn('Warning: Error clearing frame reference:', error);
        errors.push(error as Error);
      }
    }

    // Clean up page
    if (this.page) {
      try {
        // Remove all listeners to prevent memory leaks
        this.page.removeAllListeners();

        // Close the page
        await this.page.close();
        this.page = null;
        LogManager.log('Page closed successfully');
      } catch (error) {
        LogManager.error(`Error closing page: ${error}`, State.ERROR, true);
        errors.push(error as Error);

        // Force null the reference even if close failed
        this.page = null;
      }
    }

    // Clean up browser
    if (this.browser) {
      try {
        // Get all pages to ensure they're all closed
        const pages = await this.browser.pages();

        // Close any remaining pages
        for (const page of pages) {
          try {
            if (!page.isClosed()) {
              page.removeAllListeners();
              await page.close();
            }
          } catch (pageError) {
            console.warn('Warning: Error closing individual page:', pageError);
            errors.push(pageError as Error);
          }
        }

        // Remove all browser listeners
        this.browser.removeAllListeners();

        // Close the browser
        await this.browser.close();
        this.browser = null;
        LogManager.log('Browser closed successfully');
      } catch (error) {
        LogManager.error(`Error closing browser: ${error}`, State.ERROR, true);
        errors.push(error as Error);

        // Force null the reference even if close failed
        this.browser = null;
      }
    }

    // Clean up other references
    this.rect = null;

    LogManager.log(`Session ${this.sessionId} cleanup completed`);

    // If there were any errors during cleanup, log them but don't throw
    // This ensures the cleanup process completes even if some steps fail
    if (errors.length > 0) {
      console.warn(`Session ${this.sessionId} cleanup completed with ${errors.length} warnings:`, errors);
    }
  }
}

export async function runTestSession(url: string): Promise<void> {
  const session = new Session("3");

  console.log('Calling session.start...');
  const newSessionStarted = await session.start(url);
  console.log('session.start completed, result:', newSessionStarted);

  if (newSessionStarted) {
    console.log('Test session started successfully');
  } else {
    console.error('Failed to start test session');
    return;
  }

  const localX = 424 + (200 / 2) // Centered X coordinate
  const localY = 492 + (170 / 2) // Centered Y coordinate

  console.log(`Clicking at local coordinates (${localX}, ${localY}) relative to the game canvas`);
  console.log(`Canvas rect:`, session.rect);

  // Show click indicators for 10 seconds
  await session.showClickPoint(localX, localY, ClicKType.BOTH, 10000);

  // Wait a bit so you can see the indicator
  await new Promise(resolve => setTimeout(resolve, 2000));

  await session.moveMouseTo(localX, localY);
  await session.click(localX, localY);
}
