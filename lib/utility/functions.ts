import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, isAbsolute } from "node:path";
import { LogManager } from "./logManager.js";      // adjust import path if needed

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