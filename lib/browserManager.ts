import { chromium, Browser } from "playwright";

let sharedBrowser: Browser | null = null;

export async function getBrowser() {
  if (!sharedBrowser) {
    const isProduction = process.env.NODE_ENV === 'production';
    sharedBrowser = await chromium.launch({
      headless: isProduction ? true : false
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
