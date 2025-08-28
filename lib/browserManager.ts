import { chromium, Browser } from "playwright";

let sharedBrowser: Browser | null = null;

export async function getBrowser() {
  if (!sharedBrowser) {
    const isProduction = process.env.NODE_ENV === 'production';
    sharedBrowser = await chromium.launch({
      headless: isProduction ? true : String(process.env.HEADLESS).toLowerCase() === 'true',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });
  }
  return sharedBrowser;
}

export async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
