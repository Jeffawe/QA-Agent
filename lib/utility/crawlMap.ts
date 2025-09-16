/* eslint-disable no-console */
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { mkdirSync } from "node:fs";
import type { PageDetails } from "../types.js";
import { LogManager } from "./logManager.js";
import { eventBusManager } from "../services/events/eventBus.js";
import { PageMemory } from "../services/memory/pageMemory.js";

export interface Edge { from: string; to: string }

/** Pretty, page-centric crawl map for debugging */
export class CrawlMap {
  /* ───── internal state ───── */
  private static file = "crawl_map.md";

  /** order of visitation (urls) */
  private static navOrder: Set<string> = new Set();

  /** “from-->to” edge list (kept for completeness) */
  private static edges: Set<string> = new Set();

  private static initialised = false;
  private static finished = false;

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
  static recordPage(page: PageDetails, sessionId: string) {
    try {
      if (!this.initialised) this.init();
      const eventBus = eventBusManager.getOrCreateBus(sessionId);
      eventBus.emit({ ts: Date.now(), type: "crawl_map_updated", page });
      if (!PageMemory.hasPage(page.url ?? page.uniqueID)) {
        const url = PageMemory.addPageWithURL(page.url ?? page.uniqueID);
        this.navOrder.add(url);
      }
      this.write();
    } catch (e) {
      console.error("CrawlMap.recordPage error:", e);
      throw e;
    }
  }

  static finish() {
    this.finished = true;
  }

  /** Optional: keep edge list if you still need it elsewhere */
  static addEdge(from: string, to: string) {
    if (!this.initialised) this.init();
    this.edges.add(`${from}-->${to}`);
    // we *don’t* write() here; recordPage will write soon anyway
  }

  /* ───── markdown writer ───── */

  private static write() {
    if (this.navOrder.size === 0) return;
    if (this.finished) return; // prevent late writes
    let md =
      `# Crawl Map  \n_Auto-generated – refresh to see the latest state_\n\n`;

    /* ---------- quick overview ---------- */
    md += "## Quick overview\n\n";
    for (const url of this.navOrder) {
      const title = PageMemory.getPage(url)?.title ?? url;
      md += `| - ${title}\n`;
    }
    md += "\n---\n";

    /* ---------- per-page blocks ---------- */
    this.navOrder.forEach((url, idx) => {
      const page = PageMemory.getPage(url);
      if (!page) return;

      const heading = `### ${idx + 1}. ${page.title || "(untitled)"}  \n`;
      const sub = page.url ? `**URL:** ${page.url}  \n` : "";
      const desc = page.description ? `${page.description}\n` : "";
      const shot = page.screenshot ? `![screenshot](${page.screenshot})\n\n` : "";

      md += `${heading}${sub}${desc}${shot}`;

      /* ----- links ----- */
      md += "**Links:**\n\n";
      if (page.links.length === 0) {
        md += "_(none)_\n\n";
      } else {
        for (const l of page.links) {
          const box = l.visited ? "[x]" : "[ ]";
          const label = l.description || l.href;
          md += `- ${box} **${label}** → \`${l.selector}\`\n`;
        }
        md += "\n";
      }

      /* ----- test results ----- */
      if (page.testResults && page.testResults.length > 0) {
        md += "**Test Results:**\n\n";

        for (const test of page.testResults) {
          const statusIcon = test.success ? "✅" : "❌";
          const testTypeLabel = test.testType === 'positive' ? "Positive" : "Negative";
          const elementType = test.element.elementType;
          const testValue = typeof test.testValue === 'object'
            ? JSON.stringify(test.testValue)
            : String(test.testValue);

          md += `- ${statusIcon} **${testTypeLabel} Test** (${elementType})\n`;
          md += `  ↳ Element: \`${test.element.selector}\`\n`;
          md += `  ↳ Description: ${test.element.description}\n`;
          md += `  ↳ Test Value: \`${testValue}\`\n`;

          if (test.ledTo) {
            md += `  ↳ Led To: ${test.ledTo}\n`;
          }

          if (test.error) {
            md += `  ↳ Error: ${test.error}\n`;
          }

          if (test.response) {
            md += `  ↳ Response: ${test.response}\n`;
          }

          md += "\n";
        }
      }

      /* ----- analysis ----- */
      if (page.analysis) {
        md += "**Analysis:**\n\n";

        const { bugs, ui_issues, notes } = page.analysis;

        if (bugs.length) {
          md += "_Bugs_\n";
          bugs.forEach(b =>
            md += `- **(${b.severity})** ${b.description}  \n  ↳ \`${b.selector}\`\n`
          );
          md += "\n";
        }

        if (ui_issues.length) {
          md += "_UI issues_\n";
          ui_issues.forEach(u =>
            md += `- **(${u.severity})** ${u.description}  \n  ↳ \`${u.selector}\`\n`
          );
          md += "\n";
        }

        if (notes.trim()) {
          md += "_Notes_\n";
          md += `${this.indent(notes)}\n\n`;
        }
      }

      md += "---\n";
    });

    writeFileSync(this.file, md);
  }

  /* helper – indent multi-line notes for nicer MD block */
  static indent(txt: string, spaces = 2) {
    return txt.split("\n").map(l => " ".repeat(spaces) + l).join("\n");
  }
}
