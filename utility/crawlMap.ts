/* infrastructure/logging/crawlMap.ts
   ---------------------------------------------------------------------- */
/* eslint-disable no-console */
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { mkdirSync } from "node:fs";
import type { PageDetails, LinkInfo } from "../types";
import { LogManager } from "./logManager";

export interface Edge { from: string; to: string }

/** Pretty, page-centric crawl map for debugging */
export class CrawlMap {
  /* ───── internal state ───── */
  private static file = "crawl_map.md";

  /** order of visitation (urls) */
  private static navOrder: string[] = [];

  /** url → PageDetails */
  private static pages = new Map<string, PageDetails>();

  /** “from-->to” edge list (kept for completeness) */
  private static edges: Set<string> = new Set();

  private static initialised = false;

  /* ───── public API ───── */

  /** Call once at program start (optional custom path) */
  static init(filePath = "crawl_map.md") {
    const full = isAbsolute(filePath)
      ? filePath
      : join(LogManager.PROJECT_ROOT, filePath);
    this.file = full;

    const dir = dirname(full);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.initialised = true;
    this.write();        // create / clear file
  }

  /** Register page details (call as soon as PageDetails is ready) */
  static recordPage(page: PageDetails) {
    if (!this.initialised) this.init();
    if (!this.pages.has(page.url ?? page.uniqueID)) {
      this.navOrder.push(page.url ?? page.uniqueID);
    }
    this.pages.set(page.url ?? page.uniqueID, page);
    this.write();
  }

  /** Optional: keep edge list if you still need it elsewhere */
  static addEdge(from: string, to: string) {
    if (!this.initialised) this.init();
    this.edges.add(`${from}-->${to}`);
    // we *don’t* write() here; recordPage will write soon anyway
  }

  /* ───── markdown writer ───── */

  private static write() {
    let md = `# Crawl Map  \n_Auto-generated – refresh to see the latest state_\n\n`;

    /* ---------- quick overview ---------- */
    md += "## Quick overview\n\n";
    for (const url of this.navOrder) {
      const title = this.pages.get(url)?.title ?? url;
      md += `| - ${title}\n`;
    }
    md += "\n---\n";

    /* ---------- per-page blocks ---------- */
    this.navOrder.forEach((url, idx) => {
      const page = this.pages.get(url);
      if (!page) return;

      const heading = `### ${idx + 1}. ${page.title || "(untitled)"}  \n`;
      const sub = page.url ? `**URL:** ${page.url}  \n` : "";
      const desc = page.description ? `${page.description}\n` : "";

      md += `${heading}${sub}${desc}\n`;

      // links
      md += "**Links:**\n\n";
      if (page.links.length === 0) {
        md += "_(none)_\n\n";
      } else {
        for (const link of page.links) {
          const box = link.visited ? "[x]" : "[ ]";
          const label = link.text || link.href;
          md += `- ${box} **${label}** → \`${link.href}\`\n`;
        }
        md += "\n";
      }

      md += "---\n";
    });

    writeFileSync(this.file, md);
  }
}
