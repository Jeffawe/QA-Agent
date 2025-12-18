import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { PageMemory, pageMemory } from "../services/memory/pageMemory.js";
import { AnalyzerStatus, LinkInfo, StageHandObserveResult, State } from "../types.js";
import { crawlMap } from "../utility/crawlMap.js";
import { setTimeout } from "node:timers/promises";
import ManualAnalyzer from "./manualAnalyzer.js";
import StagehandSession from "../browserAuto/stagehandSession.js";
import AutoActionService from "../services/actions/autoActionService.js";
import AutoAnalyzer from "./autoanalyzer.js";
import { UniqueInternalLinkExtractor } from "../utility/links/linkExtractor.js";
import { Page } from "@browserbasehq/stagehand";
import { extractErrorMessage, isSameOriginWithPath } from "../utility/functions.js";
import { dataMemory } from "../services/memory/dataMemory.js";

export class AutoCrawler extends Agent {
    private isCurrentPageVisited = false;

    private analyzer: AutoAnalyzer;
    private manualAnalyzer: ManualAnalyzer;

    private stagehandSession: StagehandSession;

    private localactionService: AutoActionService;
    private currentLinkclicked: LinkInfo | null = null;
    private page: Page | null = null;

    private maxPagedepth: number = 10;

    private formerPageUrl: string = "";

    constructor(dependencies: BaseAgentDependencies) {
        super("autocrawler", dependencies);
        this.setState(dependencies.dependent ? State.WAIT : State.START);

        this.analyzer = this.requireAgent<AutoAnalyzer>("autoanalyzer");
        this.manualAnalyzer = this.requireAgent<ManualAnalyzer>("manualAutoanalyzer");

        this.stagehandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
        this.maxPagedepth = dataMemory.getData("maxpagedepth") as number || 10;
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`AutoCrawler requires stagehandSession, got ${this.session.constructor.name}`);
            this.errorMessage = `AutoCrawler requires stagehandSession, got ${this.session.constructor.name}`;
            this.setState(State.ERROR);
            throw new Error(`AutoCrawler requires stagehandSession, got ${this.session.constructor.name}`);
        }

        this.stagehandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`AutoCrawler requires an appropriate action service`);
            this.errorMessage = `AutoCrawler requires an appropriate action service`;
            this.setState(State.ERROR);
            throw new Error(`AutoCrawler requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        super.setBaseValues(url, mainGoal); // call the parent method to set baseUrl and currentUrl
        this.formerPageUrl = url;
    }

    async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        if (!this.page) {
            const page = await this.stagehandSession.getPage();
            if (!page) {
                this.logManager.error("Page not initialized", this.buildState());
                this.errorMessage = "Page not initialized";
                this.setState(State.ERROR);
                return;
            }
            this.page = page;
        }

        if (!this.baseUrl) {
            this.logManager.error("BaseURL not found", this.buildState());
            this.errorMessage = "BaseURL not found";
            this.setState(State.ERROR);
            return;
        }
        if (!this.bus) return;

        if (!this.currentUrl) {
            this.logManager.error("CurrentURL not found", this.buildState());
            this.errorMessage = "CurrentURL not found";
            this.setState(State.ERROR);
            return;
        }

        try {
            switch (this.state) {

                /*────────── 1. START → OBSERVE ──────────*/
                case State.START: {
                    (this as any).startTime = performance.now();
                    const newUrl = await this.stagehandSession.waitForStableUrl();

                    this.logManager.test_log(`Starting Crawler. We are at ${newUrl} which is same as ${this.currentUrl}`, this.buildState(), false);
                    if (isSameOriginWithPath(this.baseUrl, newUrl)) {
                        this.currentUrl = newUrl;
                    } else {
                        await this.local_goto(this.page, newUrl, this.currentUrl);
                    }

                    // Record the page in memory if we haven’t seen it before
                    if (!pageMemory.pageExists(this.currentUrl)) {
                        const links: StageHandObserveResult[] = await this.stagehandSession.observe();
                        const uniqueLinks = await UniqueInternalLinkExtractor.getUniqueInternalLinks(links, this.currentUrl, this.page);
                        //const externalLinks = await getExternalLinks(uniqueLinks, this.currentUrl, page);
                        this.logManager.log(`Links detected: ${uniqueLinks.length} out of ${links.length}`, this.buildState(), false);
                        const pageDetails = {
                            title: this.currentUrl,
                            url: this.currentUrl,
                            uniqueID: this.currentUrl,
                            description: '',
                            visited: false,
                            screenshot: '',
                            depth: 0,
                            hasDepth: false,
                            parentUrl: this.formerPageUrl
                        };

                        // Add depth to base url
                        if (PageMemory.cleanUrl(this.currentUrl) === PageMemory.cleanUrl(this.baseUrl)) {
                            this.logManager.test_log(`Adding depth to base url`, this.buildState(), false);
                            pageDetails.depth = 0;
                            pageDetails.hasDepth = true;

                        }

                        const linksConverted = this.convertElementsToLinks(uniqueLinks);
                        pageMemory.addPageWithLinks(pageDetails, linksConverted);
                        crawlMap.recordPage({ ...pageDetails, links: linksConverted }, this.sessionId);
                    } else {
                        this.logManager.log(`Links detected: ${pageMemory.getAllUnvisitedLinks(this.currentUrl).length}`, this.buildState(), false);
                    }

                    // Set the page depth. Can be set only once
                    pageMemory.updatePageDepth(this.currentUrl, pageMemory.getPageParentDepth(this.currentUrl) + 1);
                    this.setState(State.OBSERVE);
                    break;
                }

                case State.OBSERVE: {
                    const currentPageDepth = pageMemory.getPageDepth(this.currentUrl);
                    this.logManager.test_log(`Current page depth is ${currentPageDepth}`, this.buildState(), false);

                    // Check if max page depth is reached
                    if (currentPageDepth >= this.maxPagedepth) {
                        this.logManager.log("Max page depth reached", this.buildState(), false);
                        // Set all children of the previous page to visited
                        const previousPage = pageMemory.getPageParent(this.currentUrl);
                        if (previousPage) {
                            pageMemory.setAllLinksVisited(previousPage);
                        }
                        await this.backtrack(this.page);
                        break;
                    }

                    if (pageMemory.isFullyExplored(this.currentUrl)) {
                        this.logManager.log(`All links visited on page ${this.currentUrl}`, this.buildState(), false);
                        await this.backtrack(this.page);
                    } else {
                        // Mark the Link that was clicked last by the analyzer as visited (Did this here instead of act to avoid isFullyExplored beleiving we were done)
                        if (this.currentLinkclicked) {
                            pageMemory.markLinkVisited(this.formerPageUrl, this.currentLinkclicked.href || this.currentLinkclicked.description);
                        }

                        // Mark any link on the page that has been visited as visited
                        this.logManager.test_log(`Links seen at this point: ${JSON.stringify(Array.from(pageMemory.getVisitedLinks()))}`, this.buildState(), false);
                        pageMemory.markLinksVisited(this.currentUrl);

                        // Start appropriate analyzer
                        const unvisited = pageMemory.getAllUnvisitedLinks(this.currentUrl);
                        this.logManager.log(`Visiting ${unvisited.length} unvisited links on page ${this.currentUrl}: ${JSON.stringify(unvisited)}`, this.buildState(), false);
                        if (pageMemory.isPageVisited(this.currentUrl)) {
                            this.manualAnalyzer.enqueue(unvisited);
                            this.isCurrentPageVisited = true;
                        } else {
                            for (const l of unvisited) {
                                if (l.href) crawlMap.addEdge(this.currentUrl!, l.href);
                            }
                            pageMemory.markPageVisited(this.currentUrl);
                            const currentPage = pageMemory.getPage(this.currentUrl);
                            crawlMap.recordPage(currentPage, this.sessionId);
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

                    // Mark base url as visited
                    if (PageMemory.cleanUrl(this.currentUrl) === PageMemory.cleanUrl(this.baseUrl)) {
                        pageMemory.markVisitedLink(this.baseUrl)

                    }

                    // While waiting for the other analyzer to finish, clean the unvisited links
                    this.cleanExternalLinks(pageMemory.getAllUnvisitedLinks(this.currentUrl));

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
                        const newpage = await this.stagehandSession.waitForStableUrl();
                        if (newpage === this.currentUrl) {
                            this.setState(State.OBSERVE);
                            break;
                        }

                        this.logManager.log(`Navigated to ${newpage} from ${this.currentUrl}`, this.buildState(), false);

                        // Check if we are on the same origin, if not, go back
                        if (!isSameOriginWithPath(this.baseUrl, newpage)) {
                            await this.local_goto(this.page, newpage, this.currentUrl);
                            this.logManager.log(`Navigating back to ${this.currentUrl}`, this.buildState(), false);
                            pageMemory.markLinkVisited(this.currentUrl, this.currentLinkclicked.href || this.currentLinkclicked.description);
                            this.currentLinkclicked = null;
                            this.setState(State.OBSERVE);
                            break;
                        }

                        crawlMap.recordPage(pageMemory.getPage(this.currentUrl), this.sessionId);
                        pageMemory.pushToStack(this.currentUrl);
                        if (this.currentLinkclicked.href) crawlMap.addEdge(this.currentUrl!, this.currentLinkclicked.href);

                        const topOfStack = pageMemory.getTopOfStack();
                        if (topOfStack) {
                            this.formerPageUrl = topOfStack || this.baseUrl;
                        }

                        this.currentUrl = newpage;
                        this.setState(State.START);
                    } else {
                        // dead-end → backtrack
                        this.logManager.log("Backtracking. No more links", this.buildState(), false);
                        await this.backtrack(this.page);
                    }

                    if (this.buildState() === `${this.name}.${State.DONE}`) {
                        const endTime = performance.now();
                        this.timeTaken = endTime - (this as any).startTime;
                        this.logManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                    }

                    this.logManager.log(`State is going to be ${this.buildState()}`, this.buildState(), true);
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
            const errorMessage = extractErrorMessage(err);
            this.logManager.error(`Crawler tick error on ${this.currentUrl}: ${errorMessage}`, this.buildState());
            this.errorMessage = errorMessage;
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
            const back = pageMemory.popFromStack();
            if (back) {
                this.logManager.log(`Backtracking to ${back}`, this.buildState(), false);
                await this.local_goto(page, this.currentUrl, back);
                this.currentUrl = back;
                this.setState(State.START);
            } else {
                this.logManager.log("No more pages to backtrack to", this.buildState(), false);
                const currentPageDepth = pageMemory.getPageDepth(this.currentUrl);
                this.logManager.log(`Final page depth is ${currentPageDepth}`, this.buildState(), false);
                this.logManager.log(`Final page stack is ${this.currentUrl}`, this.buildState(), false);
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
    async local_goto(page: Page, oldPage: string, newPage: string): Promise<void> {
        try {
            await this.stagehandSession.goto(newPage, oldPage);

            this.bus.emit({
                ts: Date.now(),
                type: "new_page_visited",
                oldPage: this.baseUrl!,
                newPage: newPage,
                page: page,
                handled: true
            });
            this.logManager.test_log(`After goto, current page is ${page.url()}`, this.buildState(), false);
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
        if (!links) return;
        if (!this.baseUrl) return;

        for (const link of links) {
            if (!link.href) continue;
            if (!isSameOriginWithPath(this.baseUrl, link.href)) {
                pageMemory.markLinkVisited(this.currentUrl, link.href || link.description);
            }
        }
    }
}

