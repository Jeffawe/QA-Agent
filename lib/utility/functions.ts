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
