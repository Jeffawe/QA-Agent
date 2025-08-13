import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { PageMemory } from "../services/memory/pageMemory.js";
import { getInteractiveElements } from "../services/UIElementDetector.js";
import { InteractiveElement, LinkInfo, State } from "../types.js";
import { CrawlMap } from "../utility/crawlMap.js";
import { setTimeout } from "node:timers/promises";
import ManualTester from "./manualTester.js";
import playwrightSession from "../browserAuto/playWrightSession.js";
import Analyzer from "./analyzer.js";

export class Crawler extends Agent {
    private isCurrentPageVisited = false;
    private tester: Analyzer;
    private manualTester: ManualTester;

    private playwrightSession: playwrightSession;

    constructor(dependencies: BaseAgentDependencies) {
        super("crawler", dependencies);
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.tester = this.requireAgent<Analyzer>("analyzer");
        this.manualTester = this.requireAgent<ManualTester>("manualtester");

        this.playwrightSession = this.session as playwrightSession;
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof playwrightSession)) {
            this.logManager.error(`Crawler requires playwrightSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`PuppeteerCrawler requires playwrightSession, got ${this.session.constructor.name}`);
        }

        this.playwrightSession = this.session as playwrightSession;
    }

    async tick(): Promise<void> {
        const page = this.playwrightSession.page;
        if (!page) {
            this.logManager.error("Page not initialized", this.buildState());
            this.setState(State.ERROR);
            return;
        }
        if (!this.baseUrl) {
            this.logManager.error("BaseURL not found", this.buildState());
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
                        const elements = await getInteractiveElements(this.playwrightSession.page!);
                        const links = this.convertInteractiveElementsToLinks(elements, this.baseUrl!, this.currentUrl);
                        this.logManager.log(`Links detected: ${links.length} are: ${JSON.stringify(links)}`, this.buildState(), false);
                        const pageDetails = {
                            title: this.currentUrl,
                            url: this.currentUrl,
                            uniqueID: this.currentUrl,
                            description: '',
                            visited: false,
                            screenshot: '',
                        };
                        PageMemory.addPage2(pageDetails, links);
                        CrawlMap.recordPage({ ...pageDetails, links }, this.sessionId);
                    }
                    this.setState(State.EVALUATE);
                    break;
                }

                /*────────── 2. EVALUATE → VISIT ─────────*/
                case State.EVALUATE: {
                    if (PageMemory.isFullyExplored(this.currentUrl)) {
                        const back = PageMemory.popFromStack();
                        if (back) await page.goto(back, { waitUntil: "networkidle" });
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
                    this.logManager.log(`Visiting ${unvisited.length} unvisited linkson page ${this.currentUrl}: ${JSON.stringify(unvisited)}`, this.buildState(), false);
                    if (!PageMemory.isPageVisited(this.currentUrl)) {
                        for (const l of unvisited) CrawlMap.addEdge(this.currentUrl!, l.href);
                        PageMemory.markPageVisited(this.currentUrl);
                        isVisited = false;
                        CrawlMap.recordPage(PageMemory.pages[this.currentUrl], this.sessionId);
                    }

                    if (isVisited) {
                        this.manualTester.enqueue(unvisited, isVisited);
                    } else {
                        this.tester.enqueue(unvisited, isVisited);
                    }

                    this.isCurrentPageVisited = isVisited;
                    this.setState(State.WAIT);
                    break;
                }

                case State.WAIT: {
                    this.logManager.log("Waiting for tester to finish", this.buildState(), false);

                    if (this.isCurrentPageVisited) {
                        if (this.manualTester.isDone()) {
                            this.logManager.log("Manual tester finished", this.buildState(), false);
                            this.setState(State.ACT);
                        }
                    } else {
                        if (this.tester.isDone()) {
                            this.logManager.log("Tester finished", this.buildState(), false);
                            this.setState(State.ACT);
                        }
                    }

                    break;
                }

                /*────────── 4. ACT → (START | DONE) ─*/
                case State.ACT: {
                    const next = this.isCurrentPageVisited ? this.manualTester.nextLink : this.tester.nextLink;
                    if (next) {
                        PageMemory.markLinkVisited(this.currentUrl, next.text || next.href);
                        const finalUrl = page.url();
                        CrawlMap.recordPage(PageMemory.pages[this.currentUrl], this.sessionId);
                        PageMemory.pushToStack(this.currentUrl);
                        CrawlMap.addEdge(this.currentUrl!, next.href);

                        this.currentUrl = finalUrl;
                        this.setState(State.START);
                    } else {
                        // dead-end → backtrack
                        this.logManager.log("Backtracking. No more links", this.buildState(), false);
                        const back = PageMemory.popFromStack();
                        if (back) {
                            this.logManager.log(`Backtracking to ${back}`, this.buildState(), false);
                            await page.goto(back, { waitUntil: "networkidle" });
                            this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.currentUrl, newPage: back, page: page });
                            this.setState(State.START);
                        } else {
                            this.setState(State.DONE);
                        }
                    }

                    const endTime = performance.now();
                    this.timeTaken = endTime - (this as any).startTime;
                    this.logManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                    await setTimeout(500);
                    break;
                }

                case State.DONE:   /* fallthrough */
                case State.ERROR:  /* fallthrough */
                default:
                    break;
            }
        } catch (err) {
            this.logManager.error(`Crawler error on ${this.currentUrl}: ${err}`, this.buildState());
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

