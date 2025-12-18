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

/**
 * Extracts an error message from a given error object or value.
 * Supports various error formats including Gemini API, Stagehand, OpenAI,
 * native Error objects, and common REST API patterns.
 * @param err The error object or value to extract a message from.
 * @returns The extracted error message as a string.
 */
export function extractErrorMessage(err: unknown): string {
  const seen = new WeakSet<object>();

  function dig(value: any, depth: number = 0): string | null {
    // Prevent infinite recursion
    if (depth > 10) return null;
    if (value == null) return null;

    // Prevent circular references
    if (typeof value === "object") {
      if (seen.has(value)) return null;
      seen.add(value);
    }

    // 1. Plain string - but try to parse JSON first
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();

      // Quick check: only attempt JSON parsing if string contains { or [
      if (trimmed.includes('{') || trimmed.includes('[')) {
        // Find the first { or [ and try to parse from there
        const startIdx = Math.min(
          trimmed.indexOf('{') >= 0 ? trimmed.indexOf('{') : Infinity,
          trimmed.indexOf('[') >= 0 ? trimmed.indexOf('[') : Infinity
        );

        if (startIdx !== Infinity) {
          const jsonStr = trimmed.slice(startIdx);
          try {
            const parsed = JSON.parse(jsonStr);
            const extracted = dig(parsed, depth + 1);
            if (extracted) return extracted;
          } catch {
            // Not valid JSON, continue with original string
          }
        }
      }

      return trimmed;
    }

    // 2. Native Error - but check if message contains JSON first
    if (value instanceof Error) {
      const message = value.message;

      if (message) {
        // Check if the error message contains embedded JSON
        if (message.includes('{') || message.includes('[')) {
          const startIdx = Math.min(
            message.indexOf('{') >= 0 ? message.indexOf('{') : Infinity,
            message.indexOf('[') >= 0 ? message.indexOf('[') : Infinity
          );

          if (startIdx !== Infinity) {
            const jsonStr = message.slice(startIdx);
            try {
              const parsed = JSON.parse(jsonStr);
              const extracted = dig(parsed, depth + 1);
              if (extracted) return extracted;
            } catch {
              // Not valid JSON, fall through to return message
            }
          }
        }

        return message;
      }

      // Fallback to cause or name
      return dig((value as any).cause, depth + 1) || value.name;
    }

    // 3. Object-based errors
    if (typeof value === "object") {
      const obj = value as any;

      // Nested error objects FIRST (Gemini, OpenAI patterns)
      // This ensures we dig into error.message before checking top-level keys
      if (obj.error && typeof obj.error === "object") {
        const found = dig(obj.error, depth + 1);
        if (found) return found;
      }

      // Common string keys (ordered by priority)
      const commonKeys = [
        "message",
        "error_description",
        "errorMessage",
        "detail",
        "reason",
        "statusText",
        "blockReason", // Gemini content filtering
      ];

      for (const key of commonKeys) {
        if (typeof obj[key] === "string" && obj[key].trim()) {
          return obj[key].trim();
        }
      }

      // Response wrappers (fetch/axios)
      if (obj.response) {
        const found = dig(obj.response, depth + 1);
        if (found) return found;
      }

      if (obj.data) {
        const found = dig(obj.data, depth + 1);
        if (found) return found;
      }

      // Gemini promptFeedback
      if (obj.promptFeedback) {
        const found = dig(obj.promptFeedback, depth + 1);
        if (found) return found;
      }

      // Array patterns - check details[] first (Gemini uses this)
      const arrayKeys = ["details", "errors", "candidates"];
      for (const key of arrayKeys) {
        if (Array.isArray(obj[key])) {
          for (const item of obj[key]) {
            const found = dig(item, depth + 1);
            if (found) return found;
          }
        }
      }

      // HTTP status codes as fallback (only if no message found)
      if (typeof obj.status === "number") {
        const statusMsg = `HTTP ${obj.status}`;
        if (obj.statusText) {
          return `${statusMsg}: ${obj.statusText}`;
        }
        return statusMsg;
      }

      // Depth-first search through remaining keys (last resort)
      for (const key of Object.keys(obj)) {
        // Skip already-checked keys and non-relevant metadata
        if ([
          ...commonKeys,
          ...arrayKeys,
          "error",
          "response",
          "data",
          "promptFeedback",
          "status",
          "code", // Skip HTTP codes
          "@type", // Skip type metadata
          "domain", // Skip domain metadata
          "metadata", // Skip metadata objects
          "locale" // Skip locale
        ].includes(key)) {
          continue;
        }
        const found = dig(obj[key], depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  const extracted = dig(err);
  if (extracted) return extracted;

  // Final fallback - try to extract something useful
  if (typeof err === "object" && err !== null) {
    const obj = err as any;
    // Last ditch effort: look for any string value
    for (const value of Object.values(obj)) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  // Absolute last resort
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

export const resolveApiKey = (inputKey: string): string => {
  const UNIQUE_KEY = process.env.UNIQUE_KEY;
  if (!UNIQUE_KEY) return inputKey;

  const match = inputKey.match(/^(f|t)_([a-zA-Z0-9]+)$/);
  if (!match) return inputKey;

  const [, type, hash] = match;

  if (hash !== UNIQUE_KEY) return inputKey;

  if (type === "f") {
    if (!process.env.FREE_TRIAL_API_KEY) {
      throw new Error("FREE_TRIAL_API_KEY not configured");
    }
    return process.env.FREE_TRIAL_API_KEY;
  }

  if (type === "t") {
    if (!process.env.TEST_API_KEY) {
      throw new Error("TEST_API_KEY not configured");
    }
    return process.env.TEST_API_KEY;
  }

  return inputKey;
}


