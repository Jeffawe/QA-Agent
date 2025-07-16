/* infrastructure/logging/crawlMap.ts
   ----------------------------------------------------------- */
/* eslint-disable no-console */
import { writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { join, isAbsolute } from "path";
import { mkdirSync } from "fs";
import { LogManager } from "./logManager";

export interface Edge { from: string; to: string }

export class CrawlMap {
  // ───────── config ─────────
  private static file = "crawl_map.md";
  private static edges: Set<string> = new Set();     // "from --> to"
  private static visited: Set<string> = new Set();   // visited node URLs
  private static initialised = false;

  /** Call once at program start (optionally pass a custom path) */
  static init(filePath = "crawl_map.md") {
    // Resolve to absolute path based on PROJECT_ROOT
    const fullPath = isAbsolute(filePath)
      ? filePath
      : join(LogManager.PROJECT_ROOT, filePath);

    this.file = fullPath;

    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.initialised = true;
    this.write(); // create or clear the file
  }

  /** Register every hyperlink the crawler traverses */
  static addEdge(from: string, to: string) {
    if (!this.initialised) this.init();
    this.edges.add(`${from}-->${to}`);
    this.write();
  }

  /** Mark a page as “visited” (green in the graph) */
  static markVisited(url: string) {
    if (!this.initialised) this.init();
    this.visited.add(url);
    this.write();
  }

  /* ───────── internal helpers ───────── */

  /** Turn any URL into a Mermaid-safe identifier */
  private static nodeId(url: string) {
    return url.replace(/[^a-zA-Z0-9]/g, "_");
  }

  /** Regenerates the entire .md file from current in-memory state */
  private static write() {
    let md = `# Crawl Map\n\n` +
      `> Auto-generated – refresh to see the latest crawl state\n\n` +
      "```mermaid\ngraph LR\n";

    // draw edges
    for (const line of this.edges) {
      const [from, to] = line.split("-->");
      md += `    ${this.nodeId(from)}("${from}") --> ${this.nodeId(to)}("${to}")\n`;
    }

    // highlight visited nodes
    if (this.visited.size) {
      md += "\n    %% visited pages\n";
      for (const url of this.visited) {
        md += `    class ${this.nodeId(url)} visited;\n`;
      }
      md += "    classDef visited fill:#b6fcb6,stroke:#333;\n";
    }

    md += "```\n";
    writeFileSync(this.file, md);
  }
}
