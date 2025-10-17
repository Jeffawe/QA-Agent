import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, isAbsolute } from "node:path";
import { LogManager } from "./logManager.js";

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

/**
 * Wraps a promise with a timeout.
 * If the promise resolves before the timeout, the wrapped promise resolves with the same value.
 * If the promise does not resolve before the timeout, the wrapped promise rejects with an Error('Timeout').
 * @param {Promise<T>} promise The promise to wrap.
 * @param {number} timeoutMs The timeout in milliseconds.
 * @returns {Promise<T>} The wrapped promise.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    )
  ]);
}

/**
 * Checks if two URLs are same-origin, considering the base path.
 * 
 * @param oldUrl - The original URL (defines the allowed origin and base path)
 * @param newUrl - The URL to check against
 * @returns true if newUrl is within the same origin and base path as oldUrl
 * 
 * @example
 * isSameOriginWithPath('https://www.qa-agent.site/demo', 'https://www.qa-agent.site/demo/page1') // true
 * isSameOriginWithPath('https://www.qa-agent.site/demo', 'https://www.qa-agent.site/other') // false
 * isSameOriginWithPath('https://www.qa-agent.site/demo', 'https://other-site.com/demo') // false
 */
export function isSameOriginWithPath(oldUrl: string, newUrl: string): boolean {
  const old = new URL(oldUrl);
  const newU = new URL(newUrl);

  // Check protocol and hostname match
  if (old.protocol !== newU.protocol || old.hostname !== newU.hostname) {
    return false;
  }

  // Get the base path from old URL (everything up to the last segment)
  // Remove trailing slash for consistent comparison
  const oldPath = old.pathname.replace(/\/$/, '');
  const newPath = newU.pathname.replace(/\/$/, '');

  // Check if new path starts with the old path
  // If oldPath is '/demo', newPath must be '/demo' or '/demo/...'
  return newPath === oldPath || newPath.startsWith(oldPath + '/');
}
