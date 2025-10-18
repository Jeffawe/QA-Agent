import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { PageMemory } from "../services/memory/pageMemory.js";
import { AnalyzerStatus, LinkInfo, StageHandObserveResult, State } from "../types.js";
import { CrawlMap } from "../utility/crawlMap.js";
import { setTimeout } from "node:timers/promises";
import ManualAnalyzer from "./manualAnalyzer.js";
import StagehandSession from "../browserAuto/stagehandSession.js";
import AutoActionService from "../services/actions/autoActionService.js";
import AutoAnalyzer from "./autoanalyzer.js";
import { UniqueInternalLinkExtractor } from "../utility/links/linkExtractor.js";
import { Page } from "@browserbasehq/stagehand";
import { isSameOriginWithPath } from "../utility/functions.js";

export class AutoCrawler extends Agent {
    private isCurrentPageVisited = false;

    private analyzer: AutoAnalyzer;
    private manualAnalyzer: ManualAnalyzer;

    private stagehandSession: StagehandSession;

    private localactionService: AutoActionService;
    private currentLinkclicked: LinkInfo | null = null;
    private page: Page | null = null;

    constructor(dependencies: BaseAgentDependencies) {
        super("autocrawler", dependencies);
        this.setState(dependencies.dependent ? State.WAIT : State.START);

        this.analyzer = this.requireAgent<AutoAnalyzer>("autoanalyzer");
        this.manualAnalyzer = this.requireAgent<ManualAnalyzer>("manualAutoanalyzer");

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

        if (!this.page) {
            const page = await this.stagehandSession.getPage();
            if (!page) {
                this.logManager.error("Page not initialized", this.buildState());
                this.setState(State.ERROR);
                return;
            }
            this.page = page;
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

                /*────────── 1. START → OBSERVE ──────────*/
                case State.START: {
                    (this as any).startTime = performance.now();
                    const newUrl = this.page.url();

                    this.logManager.log(`Starting Crawler. We are at ${newUrl} from ${this.currentUrl}`, this.buildState(), false);
                    if (isSameOriginWithPath(newUrl, this.baseUrl)) {
                        this.currentUrl = newUrl;
                    } else {
                        await this.goto(this.page, newUrl, this.currentUrl);
                    }

                    // Record the page in memory if we haven’t seen it before
                    if (!PageMemory.pageExists(this.currentUrl)) {
                        const links: StageHandObserveResult[] = await this.stagehandSession.observe()
                        const uniqueLinks = await UniqueInternalLinkExtractor.getUniqueInternalLinks(links, this.currentUrl, this.page);
                        //const externalLinks = await getExternalLinks(uniqueLinks, this.currentUrl, page);
                        this.logManager.log(`Links detected: ${uniqueLinks.length} out of ${links.length} are: ${JSON.stringify(uniqueLinks)}`, this.buildState(), false);
                        const pageDetails = {
                            title: this.currentUrl,
                            url: this.currentUrl,
                            uniqueID: this.currentUrl,
                            description: '',
                            visited: false,
                            screenshot: '',
                        };
                        const linksConverted = this.convertElementsToLinks(uniqueLinks);
                        PageMemory.addPageWithLinks(pageDetails, linksConverted);
                        CrawlMap.recordPage({ ...pageDetails, links: linksConverted }, this.sessionId);
                    } else {
                        this.logManager.log(`Links detected: ${PageMemory.getAllUnvisitedLinks(this.currentUrl).length}`, this.buildState(), false);
                    }

                    this.setState(State.OBSERVE);
                    break;
                }

                case State.OBSERVE: {
                    this.logManager.log(`Observing page ${this.currentUrl}. We are on ${this.page.url()}`, this.buildState(), false);
                    if (PageMemory.isFullyExplored(this.currentUrl)) {
                        this.logManager.log(`All links visited on page ${this.currentUrl}`, this.buildState(), false);
                        this.backtrack(this.page);
                    } else {
                        // Mark the Link that was clicked last by the analyzer as visited (Did this here instead of act to avoid isFullyExplored beleiving we were done)
                        if (this.currentLinkclicked) {
                            PageMemory.markLinkVisited(this.currentUrl, this.currentLinkclicked.description);
                        }

                        // Start appropriate analyzer
                        const unvisited = PageMemory.getAllUnvisitedLinks(this.currentUrl);
                        this.logManager.log(`Visiting ${unvisited.length} unvisited links on page ${this.currentUrl}: ${JSON.stringify(unvisited)}`, this.buildState(), false);
                        if (PageMemory.isPageVisited(this.currentUrl)) {
                            this.manualAnalyzer.enqueue(unvisited);
                            this.isCurrentPageVisited = true;
                        } else {
                            for (const l of unvisited) {
                                if (l.href) CrawlMap.addEdge(this.currentUrl!, l.href);
                            }
                            PageMemory.markPageVisited(this.currentUrl);
                            const currentPage = PageMemory.getPage(this.currentUrl);
                            CrawlMap.recordPage(currentPage, this.sessionId);
                            this.analyzer.enqueue(unvisited);
                            this.isCurrentPageVisited = false;

                        }
                        this.setState(State.WAIT);
                    }
                    break;
                }

                case State.WAIT: {
                    this.logManager.log("Waiting for analyzer to finish", this.buildState(), false);

                    if (this.isCurrentPageVisited) {
                        if (this.manualAnalyzer.isDone()) {
                            this.logManager.log("Manual analyzer finished", this.buildState(), false);
                            this.setState(State.ACT);
                        }
                    } else {
                        if (this.analyzer.isDone()) {
                            this.logManager.log("Analyzer finished", this.buildState(), false);
                            this.setState(State.ACT);
                        }
                    }

                    // While waiting for the other analyzer to finish, clean the unvisited links
                    this.cleanExternalLinks(PageMemory.getAllUnvisitedLinks(this.currentUrl));

                    break;
                }

                /*────────── 4. ACT → (START | DONE) ─*/
                case State.ACT: {
                    if (!this.isCurrentPageVisited && this.analyzer.analyzerStatus == AnalyzerStatus.PAGE_NOT_SEEN) {
                        this.logManager.error("Analyzer did not see the page", this.buildState());
                        this.setState(State.START);
                        break;
                    }

                    // Extract the active link clicked on to get where we are
                    this.currentLinkclicked = this.isCurrentPageVisited ? this.manualAnalyzer.activeLink : this.analyzer.activeLink;


                    if (this.currentLinkclicked) {
                        const newpage = this.page.url();
                        this.logManager.log(`Navigated to ${newpage} from ${this.currentUrl}`, this.buildState(), false);

                        // Check if we are on the same origin, if not, go back
                        if (!isSameOriginWithPath(this.currentUrl, newpage)) {
                            await this.goto(this.page, newpage, this.currentUrl);
                            this.logManager.log(`Navigating back to ${this.currentUrl}`, this.buildState(), false);
                            PageMemory.markLinkVisited(this.currentUrl, this.currentLinkclicked.description);
                            this.currentLinkclicked = null;
                            this.setState(State.OBSERVE);
                            return;
                        }

                        CrawlMap.recordPage(PageMemory.getPage(this.currentUrl), this.sessionId);
                        PageMemory.pushToStack(this.currentUrl);
                        if (this.currentLinkclicked.href) CrawlMap.addEdge(this.currentUrl!, this.currentLinkclicked.href);

                        this.currentUrl = newpage;
                        this.setState(State.START);
                    } else {
                        // dead-end → backtrack
                        this.logManager.log("Backtracking. No more links", this.buildState(), false);
                        this.backtrack(this.page);
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
        links: StageHandObserveResult[] // e.g. "https://example.com/foo/bar"
    ): LinkInfo[] {
        return links.map(el => ({
            description: el.description || "",
            selector: el.selector,
            method: el.method || "click",
            href: el.extractedUrl,
            arguments: el.arguments,
            visited: false,
        }));
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

    private async backtrack(page: Page): Promise<void> {
        try {
            const back = PageMemory.popFromStack();
            if (back) {
                this.logManager.log(`Backtracking to ${back}`, this.buildState(), false);
                await this.goto(page, this.currentUrl, back);
                this.currentUrl = back;
                this.setState(State.START);
            } else {
                this.logManager.log("No more pages to backtrack to", this.buildState(), false);
                this.setState(State.DONE);
            }
        } catch (err) {
            this.logManager.error(`Crawler error on ${this.currentUrl}: ${err}`, this.buildState());
            throw err;
        }
    }

    /**
     * Navigates to a new page and emits an event when the page is loaded.
     * @param page - The playwright page to navigate
     * @param oldPage - The URL of the page before navigation
     * @param newPage - The URL of the page to navigate to
     */
    async goto(page: Page, oldPage: string, newPage: string): Promise<void> {
        try {
            if (oldPage === newPage) {
                this.logManager.log(`Navigating to same page: ${newPage}`, this.buildState(), false);
                return;
            }

            await page.goto(newPage, { waitUntil: "domcontentloaded" });
            this.bus.emit({
                ts: Date.now(),
                type: "new_page_visited",
                oldPage: oldPage,
                newPage: newPage,
                page: page,
                handled: true
            });
        } catch (err) {
            this.logManager.error(`Crawler error on ${newPage}: ${err}`, this.buildState());
            throw err;
        }
    }

    async cleanup(): Promise<void> {
        this.currentUrl = "";
        this.isCurrentPageVisited = false;
        this.timeTaken = 0;
        this.response = "";
    }

    async cleanExternalLinks(links: LinkInfo[]): Promise<void> {
        if(!links) return;

        for (const link of links) {
            if (!link.href) continue;
            if (!isSameOriginWithPath(this.currentUrl, link.href)) {
                PageMemory.markLinkVisited(this.currentUrl, link.description);
            }
        }
    }
}

