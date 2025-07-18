import { Agent } from "../utility/abstract";
import { LogManager } from "../utility/logManager";
import Session from "../models/session";
import { PageMemory } from "../services/memory/pageMemory";
import { getInteractiveElements } from "../services/UIElementDetector";
import { InteractiveElement, LinkInfo, State } from "../types";
import { EventBus } from "../services/events/event";
import Tester from "./tester";
import { CrawlMap } from "../utility/crawlMap";
import { setTimeout } from "node:timers/promises";

export class Crawler extends Agent {
    currentUrl: string | null = null;
    public baseUrl: string | null = null;

    constructor(
        private session: Session,
        private tester: Tester,
        eventBus: EventBus
    ) {
        super("Crawler", eventBus);
    }

    setBaseUrl(url: string) {
        this.baseUrl = url;
        this.currentUrl = url;
    }

    async tick(): Promise<void> {
        const page = this.session.page;
        if (!page) {
            LogManager.error("Page not initialized", this.buildState());
            this.setState(State.ERROR);
            return;
        }
        if (!this.baseUrl) {
            LogManager.error("BaseURL not found", this.buildState());
            this.setState(State.ERROR);
            return;
        }
        if (!this.bus) return;

        if (!this.currentUrl) {
            this.setState(State.ERROR);
            return;
        }

        try {
            switch (this.state) {

                /*────────── 1. START → EVALUATE ──────────*/
                case State.START: {
                    (this as any).startTime = performance.now();
                    this.currentUrl = page.url();
                    if (!PageMemory.pageExists(this.currentUrl)) {
                        const elements = await getInteractiveElements(this.session.page!);
                        const links = this.convertInteractiveElementsToLinks(elements, this.baseUrl!, this.currentUrl);
                        LogManager.log(`Links detected: ${links.length} are: ${JSON.stringify(links)}`, this.buildState(), false);
                        const pageDetails = {
                            title: this.currentUrl,
                            url: this.currentUrl,
                            uniqueID: this.currentUrl,
                            description: '',
                            visited: false,
                            screenshot: '',
                        };
                        PageMemory.addPage2(pageDetails, links);
                        CrawlMap.recordPage({ ...pageDetails, links });
                    }
                    this.setState(State.EVALUATE);
                    break;
                }

                /*────────── 2. EVALUATE → VISIT ─────────*/
                case State.EVALUATE: {
                    if (PageMemory.isFullyExplored(this.currentUrl)) {
                        const back = PageMemory.popFromStack();
                        if (back) await page.goto(back, { waitUntil: "networkidle0" });
                        else this.setState(State.DONE);
                    } else {
                        this.setState(State.VISIT);
                    }
                    break;
                }

                /*────────── 3. VISIT → ACT ─────────────*/
                case State.VISIT: {
                    let isVisited = true;
                    const unvisited = PageMemory.getAllUnvisitedLinks(this.currentUrl);
                    LogManager.log(`Visiting ${unvisited.length} unvisited linkson page ${this.currentUrl}: ${JSON.stringify(unvisited)}`, this.buildState(), false);
                    if (!PageMemory.isPageVisited(this.currentUrl)) {
                        for (const l of unvisited) CrawlMap.addEdge(this.currentUrl!, l.href);
                        PageMemory.markPageVisited(this.currentUrl);
                        isVisited = false;
                        CrawlMap.recordPage(PageMemory.pages[this.currentUrl]);
                    }
                    this.tester.enqueue(unvisited, isVisited);
                    this.setState(State.WAIT);
                    break;
                }

                case State.WAIT: {
                    LogManager.log("Waiting for tester to finish", this.buildState(), false);
                    if (this.tester.isDone()) {
                        LogManager.log("Tester finished", this.buildState(), false);
                        this.setState(State.ACT);
                    }
                    break;
                }

                /*────────── 4. ACT → (START | DONE) ─*/
                case State.ACT: {
                    const next = this.tester.nextLink;
                    if (next) {
                        PageMemory.markLinkVisited(this.currentUrl, next.text || next.href);
                        const finalUrl = page.url();
                        CrawlMap.recordPage(PageMemory.pages[this.currentUrl]);
                        PageMemory.pushToStack(this.currentUrl);
                        CrawlMap.addEdge(this.currentUrl!, next.href);

                        this.currentUrl = finalUrl;
                        this.setState(State.START);
                    } else {
                        // dead-end → backtrack
                        LogManager.log("Backtracking. No more links", this.buildState(), false);
                        const back = PageMemory.popFromStack();
                        if (back) {
                            LogManager.log(`Backtracking to ${back}`, this.buildState(), false);
                            await page.goto(back, { waitUntil: "networkidle0" });
                            this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.currentUrl, newPage: back, page: page });
                            this.setState(State.START);
                        } else {
                            this.setState(State.DONE);
                        }
                    }

                    const endTime = performance.now();
                    this.timeTaken = endTime - (this as any).startTime;
                    LogManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                    await setTimeout(500);
                    break;
                }

                case State.DONE:   /* fallthrough */
                case State.ERROR:  /* fallthrough */
                default:
                    break;
            }
        } catch (err) {
            LogManager.error(`Crawler error on ${this.currentUrl}: ${err}`, this.buildState());
            this.setState(State.ERROR);
        }
    }

    /**
     * Convert DOM‐level interactive elements to LinkInfo objects.
     * – Keeps only internal links
     * – Deduplicates by absolute URL (ignoring #hash)
     * – Drops links that point to the current page
     */
    convertInteractiveElementsToLinks(
        elements: InteractiveElement[],
        baseURL: string,       // e.g. "https://example.com"
        currentURL: string     // e.g. "https://example.com/foo/bar"
    ): LinkInfo[] {
        const links: LinkInfo[] = [];
        const seen = new Set<string>();          // absolute URLs we’ve already emitted
        const current = this.normalise(currentURL, baseURL); // for self-link check

        for (const el of elements) {
            const rawHref = el.attributes.href?.trim();
            if (!rawHref) continue;                // no href → nothing to follow

            // Internal / external check stays exactly as before
            const isInternal =
                rawHref.startsWith(baseURL) ||
                rawHref.startsWith("/") ||
                (!rawHref.startsWith("http") && !rawHref.startsWith("https"));

            if (!isInternal) continue;

            if (rawHref.startsWith("mailto:") ||
                rawHref.startsWith("tel:") ||
                rawHref.startsWith("javascript:") ||
                rawHref.startsWith("#") ||                        // internal page jump
                rawHref.includes("logout") ||                     // avoid logouts
                new URL(rawHref, baseURL).host !== new URL(baseURL).host  // cross-domain
            ) continue;

            // Resolve to an absolute URL and normalise for comparisons
            const absHref = this.normalise(rawHref, baseURL);

            // Skip if it’s the page we’re already on
            if (absHref === current) continue;

            // Skip duplicates (buttons/links that hit the same endpoint)
            if (seen.has(absHref)) continue;
            seen.add(absHref);

            // Emit the first one we encounter
            links.push({
                text:
                    el.label ||
                    el.attributes["aria-label"] ||
                    el.attributes["data-testid"] ||
                    "",
                selector: el.selector,
                href: absHref,
                visited: false
            });
        }

        return links;
    }

    /** Normalise a URL: resolve relative → absolute, strip hash, trim trailing “/” */
    normalise(href: string, base: string): string {
        try {
            const url = new URL(href, base);
            url.hash = "";                           // ignore in-page anchors
            if (url.pathname.endsWith("/") && url.pathname !== "/") {
                url.pathname = url.pathname.slice(0, -1); // /foo/ → /foo
            }
            return url.href;
        } catch {
            // Invalid URL? fall back to raw string so the caller can decide
            return href;
        }
    }

    async cleanup(): Promise<void> {
        this.state = State.START;
    }
}

