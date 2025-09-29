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
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows', // prevent throttling for hidden windows
        '--disable-features=CalculateNativeWinOcclusion' // ensures Chromium thinks the window is visible
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
