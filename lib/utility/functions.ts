import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, isAbsolute } from "node:path";
import { LogManager } from "./logManager.js";      // adjust import path if needed
import { StageHandObserveResult } from "../types.js";

/** Check whether a file exists under PROJECT_ROOT */
export async function fileExists(pathFromRoot: string): Promise<boolean> {
  // Resolve to absolute path
  const abs = isAbsolute(pathFromRoot)
    ? pathFromRoot
    : join(LogManager.PROJECT_ROOT, pathFromRoot.replace(/^[/\\]/, ""));

  try {
    await access(abs, constants.F_OK);          // throws if file doesn’t exist
    return true;
  } catch {
    return false;
  }
}

export async function getExternalLinks(
  links: StageHandObserveResult[],
  currentUrl: string,
  page: any
): Promise<StageHandObserveResult[]> {
  const currentDomain = new URL(currentUrl).origin;
  const externalLinks: StageHandObserveResult[] = [];

  for (const link of links) {
    try {
      // Use Playwright to get the actual href attribute
      const element = await page.locator(link.selector).first();

      // Check if element exists and is visible
      const isVisible = await element.isVisible().catch(() => false);
      if (!isVisible) continue;

      // Get the href attribute
      const href = await element.getAttribute('href').catch(() => null);

      // Skip if no href (not a navigation link)
      if (!href) continue;

      // Skip internal page actions
      if (href.startsWith('#') ||
        href.startsWith('javascript:') ||
        href.includes('mailto:') ||
        href.includes('tel:')) {
        continue;
      }

      // Check if it's an external link
      if (href.startsWith('http://') || href.startsWith('https://')) {
        const linkUrl = new URL(href);
        if (linkUrl.origin !== currentDomain) {
          externalLinks.push(link);
        }
      }
      // Relative URLs starting with / are usually page navigations
      else if (href.startsWith('/') || href.includes('/')) {
        externalLinks.push(link);
      }

    } catch (error) {
      console.warn(`Error inspecting link ${link.selector}:`, error);
      externalLinks.push(link);
    }
  }

  return externalLinks;
}
