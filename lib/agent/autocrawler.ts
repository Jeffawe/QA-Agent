import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { PageMemory } from "../services/memory/pageMemory.js";
import { LinkInfo, StageHandObserveResult, State } from "../types.js";
import { CrawlMap } from "../utility/crawlMap.js";
import { setTimeout } from "node:timers/promises";
import ManualAnalyzer from "./manualAnalyzer.js";
import StagehandSession from "../browserAuto/stagehandSession.js";
import AutoActionService from "../services/actions/autoActionService.js";
import { getExternalLinks } from "../utility/functions.js";
import AutoAnalyzer from "./autoanalyzer.js";

export class AutoCrawler extends Agent {
    private isCurrentPageVisited = false;

    private analyzer: AutoAnalyzer;
    private manualAnalyzer: ManualAnalyzer;

    private stagehandSession: StagehandSession;

    private localactionService: AutoActionService;

    constructor(dependencies: BaseAgentDependencies) {
        super("autocrawler", dependencies);
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.analyzer = this.requireAgent<AutoAnalyzer>("autoanalyzer");
        this.manualAnalyzer = this.requireAgent<ManualAnalyzer>("manualanalyzer");

        this.stagehandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`AutoCrawler requires stagehandSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`AutoCrawler requires stagehandSession, got ${this.session.constructor.name}`);
        }

        this.stagehandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`AutoCrawler requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`AutoCrawler requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
    }

    async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        const page = this.stagehandSession.page;
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
                    // Record the page in memory if we haven’t seen it before
                    if (!PageMemory.pageExists(this.currentUrl)) {
                        const links: StageHandObserveResult[] = await this.stagehandSession.observe()
                        const externalLinks = await getExternalLinks(links, this.currentUrl, page);
                        this.logManager.log(`Links detected: ${links.length} are: ${JSON.stringify(links)}`, this.buildState(), false);
                        const pageDetails = {
                            title: this.currentUrl,
                            url: this.currentUrl,
                            uniqueID: this.currentUrl,
                            description: '',
                            visited: false,
                            screenshot: '',
                        };
                        const linksConverted = this.convertElementsToLinks(externalLinks);
                        const linkWithoutVisited = linksConverted.map(link => {
                            const { visited, ...rest } = link;
                            return rest;
                        });
                        PageMemory.addPage2(pageDetails, linkWithoutVisited);
                        CrawlMap.recordPage({ ...pageDetails, links: linksConverted }, this.sessionId);
                    } else {
                        this.logManager.log(`Links detected: ${PageMemory.getAllUnvisitedLinks(this.currentUrl).length}`, this.buildState(), false);
                    }
                    this.setState(State.EVALUATE);
                    break;
                }

                /*────────── 2. EVALUATE → VISIT ─────────*/
                case State.EVALUATE: {
                    if (PageMemory.isFullyExplored(this.currentUrl)) {
                        this.logManager.log(`All links visited on page ${this.currentUrl}`, this.buildState(), false);
                        const back = PageMemory.popFromStack();
                        if (back) await page.goto(back, { waitUntil: "networkidle", timeout: 30000 });
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
                        for (const l of unvisited) {
                            if (l.href) CrawlMap.addEdge(this.currentUrl!, l.href);
                        }
                        PageMemory.markPageVisited(this.currentUrl);
                        isVisited = false;
                        CrawlMap.recordPage(PageMemory.pages[this.currentUrl], this.sessionId);
                    }

                    if (isVisited) {
                        this.manualAnalyzer.enqueue(unvisited, isVisited);
                    } else {
                        this.analyzer.enqueue(unvisited, isVisited);
                    }

                    this.isCurrentPageVisited = isVisited;
                    this.setState(State.WAIT);
                    break;
                }

                case State.WAIT: {
                    this.logManager.log("Waiting for tester to finish", this.buildState(), false);

                    if (this.isCurrentPageVisited) {
                        if (this.manualAnalyzer.isDone()) {
                            this.logManager.log("Manual tester finished", this.buildState(), false);
                            this.setState(State.ACT);
                        }
                    } else {
                        if (this.analyzer.isDone()) {
                            this.logManager.log("Tester finished", this.buildState(), false);
                            this.setState(State.ACT);
                        }
                    }

                    break;
                }

                /*────────── 4. ACT → (START | DONE) ─*/
                case State.ACT: {
                    if (!this.isCurrentPageVisited && !this.analyzer.noErrors) {
                        this.logManager.error("Analyzer did not see the page", this.buildState());
                        this.setState(State.START);
                        break;
                    }

                    const next = this.isCurrentPageVisited ? this.manualAnalyzer.nextLink : this.analyzer.nextLink;
                    if (next) {
                        PageMemory.markLinkVisited(this.currentUrl, next.description);
                        const finalUrl = page.url();
                        CrawlMap.recordPage(PageMemory.pages[this.currentUrl], this.sessionId);
                        PageMemory.pushToStack(this.currentUrl);
                        if (next.href) CrawlMap.addEdge(this.currentUrl!, next.href);

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

                case State.PAUSE:
                case State.DONE:
                case State.RESUME:
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
    convertElementsToLinks(
        links: StageHandObserveResult[]     // e.g. "https://example.com/foo/bar"
    ): LinkInfo[] {
        const out: LinkInfo[] = [];

        for (const el of links) {
            const newLink: LinkInfo = {
                description: el.description || "",
                selector: el.selector,
                method: el.method || "click",
                href: this.normalise(el.selector, this.currentUrl),
                arguments: el.arguments,
                visited: false,
            };

            out.push(newLink);
        }

        return out;
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
        this.currentUrl = "";
        this.isCurrentPageVisited = false;
        this.timeTaken = 0;
        this.response = "";
    }
}

