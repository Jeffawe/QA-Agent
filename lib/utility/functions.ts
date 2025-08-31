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

export function getExternalLinks(
  links: StageHandObserveResult[],
  currentUrl: string
): StageHandObserveResult[] {
  const currentDomain = new URL(currentUrl).origin;

  return links.filter(link => {
    // Check if it's a clickable element (has click method or is a link)
    const isClickable = link.method === 'click' ||
      link.selector.toLowerCase().includes('a[href]') ||
      link.selector.toLowerCase().includes('link');

    if (!isClickable) return false;

    // Get href from arguments if available
    const href = link.arguments?.[0] || '';

    // Skip if no href or it's empty
    if (!href || href.trim() === '') return false;

    // Filter out internal page actions (these typically don't lead to new pages)
    const internalActionPatterns = [
      /^#/,                           // Hash links (anchors, modals)
      /^javascript:/i,                // JavaScript actions
      /^void\(0\)/i,                 // void(0) links
      /^$/,                          // Empty hrefs
      /^mailto:/i,                   // Email links (not page navigation)
      /^tel:/i,                      // Phone links
      /^sms:/i,                      // SMS links
      /^ftp:/i,                      // FTP links (not web pages)
    ];

    // Check if it matches any internal action pattern
    if (internalActionPatterns.some(pattern => pattern.test(href))) {
      return false;
    }

    // Check description for common internal action keywords
    const internalActionKeywords = [
      'modal', 'popup', 'dropdown', 'toggle', 'expand', 'collapse',
      'show', 'hide', 'open', 'close', 'accordion', 'tab',
      'filter', 'sort', 'search', 'submit', 'cancel'
    ];

    const descriptionLower = link.description.toLowerCase();
    if (internalActionKeywords.some(keyword => descriptionLower.includes(keyword))) {
      return false;
    }

    // Check if selector indicates it's likely an internal action
    const selectorLower = link.selector.toLowerCase();
    const internalSelectorPatterns = [
      'button[data-toggle]',
      'button[data-modal]',
      '[data-dismiss]',
      '.modal-trigger',
      '.dropdown-toggle',
      '.accordion-toggle',
      '[aria-expanded]',
      '.tab-link',
      '.filter-button'
    ];

    if (internalSelectorPatterns.some(pattern => selectorLower.includes(pattern.toLowerCase()))) {
      return false;
    }

    try {
      // If it's a full URL, check if it's external
      if (href.startsWith('http://') || href.startsWith('https://')) {
        const linkUrl = new URL(href);
        // Return true for different domains (external links)
        return linkUrl.origin !== currentDomain;
      }

      // If it's a relative URL starting with /, it's likely a page navigation
      if (href.startsWith('/')) {
        return true;
      }

      // If it has file extensions commonly associated with pages
      const pageExtensions = ['.html', '.htm', '.php', '.jsp', '.asp', '.aspx'];
      if (pageExtensions.some(ext => href.toLowerCase().includes(ext))) {
        return true;
      }

      // If it's a relative path without hash/query that looks like navigation
      if (href.includes('/') && !href.includes('?') && !href.includes('#')) {
        return true;
      }

    } catch (error) {
      // If URL parsing fails, it might still be a relative navigation link
      console.warn('Error parsing URL:', href, error);
    }

    // Default: if we can't determine, assume it's external if it looks like a navigation
    return !href.includes('javascript:') &&
      !href.startsWith('#') &&
      href.length > 0;
  });
}
