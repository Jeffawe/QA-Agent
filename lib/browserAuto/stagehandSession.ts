import { Page } from "@browserbasehq/stagehand";
import { Session } from "../utility/abstract";
import fs from 'fs';
import path from 'path';
import { ClicKType, Rect, State } from '../types.js';
import { LogManager } from '../utility/logManager.js';

export default class StagehandSession extends Session<Page> {
    public start(url: string): Promise<boolean> {
        throw new Error("Method not implemented.");
    }
    public close(): Promise<void> {
        throw new Error("Method not implemented.");
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

}