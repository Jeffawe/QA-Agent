import { chromium, Browser } from "playwright";

let sharedBrowser: Browser | null = null;

export async function getBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({ headless: false });
  }
  return sharedBrowser;
}

export async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
