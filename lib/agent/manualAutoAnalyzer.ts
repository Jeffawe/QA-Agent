import { Page } from "@browserbasehq/stagehand";
import StagehandSession from "../browserAuto/stagehandSession.js";
import AutoActionService from "../services/actions/autoActionService.js";
import { pageMemory } from "../services/memory/pageMemory.js";
import { Action, LinkInfo, State } from "../types.js";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { isSameOriginWithPath } from "../utility/functions.js";

export default class ManualAutoAnalyzer extends Agent {
    public activeLink: LinkInfo | null = null;
    private stageHandSession: StagehandSession;
    private localactionService: AutoActionService;

    private queue: LinkInfo[] = [];
    private goal: string = "";
    private page: Page | null = null;

    constructor(dependencies: BaseAgentDependencies) {
        super("manualAutoanalyzer", dependencies);
        this.goal = "";
        this.setState(dependencies.dependent ? State.WAIT : State.START);
        this.validatorWarningState = dependencies.dependent ? State.WAIT : State.START;

        this.stageHandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        this.baseUrl = url;
        this.localactionService.setBaseUrl(url);
        this.goal = mainGoal || "";
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`ManualAutoAnalyzer requires stagehandSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`ManualAutoAnalyzer requires stagehandSession, got ${this.session.constructor.name}`);
        }

        this.stageHandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`ManualAnalyzer requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`ManualAnalyzer requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
    }

    /* ───────── external API ───────── */
    /** Crawler (or any agent) calls this to add links to be tested */
    public enqueue(links: LinkInfo[], visitedPage: boolean = false) {
        this.queue = links;
        if (!visitedPage) {
            this.setState(State.DONE);
        }
        if (this.state === State.DONE || this.state === State.WAIT) {
            this.setState(State.START);
        } else {
            this.logManager.log("ManualAutoAnalyzer is already running or cannot start up", this.buildState(), true);
        }
    }

    /** One FSM transition */
    public async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        if (!this.page) {
            const page = await this.stageHandSession.getPage();
            if (!page) {
                throw new Error("Page not initialized");
            }
            this.page = page;
        }

        if (!this.baseUrl) {
            throw new Error("Base URL not initialized");
        }

        if (!this.bus) return

        try {
            switch (this.state) {
                /*────────── READY → RUN ──────────*/
                case State.START:
                    (this as any).startTime = performance.now();
                    this.currentUrl = await this.stageHandSession.waitForStableUrl();
                    this.goal = "Find the next best link to click";
                    this.logManager.log(`Start testing ${this.queue.length} links from ${this.currentUrl}`, this.buildState(), true);
                    if (this.queue.length === 0) {
                        this.logManager.log("No more links to test", this.buildState(), true);
                        this.setState(State.DONE);
                    } else {
                        this.setState(State.DECIDE);
                    }
                    break;

                case State.DECIDE: {
                    if (this.queue.length === 0) {
                        this.logManager.log("No more links to test", this.buildState(), true);
                        this.setState(State.DONE);
                        break;
                    }
                    this.activeLink = this.queue.shift()!;
                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    const t0 = Date.now();
                    try {
                        if (!this.activeLink || !this.activeLink.selector) {
                            this.logManager.error("activeLink is null", this.state, false);
                            throw new Error("activeLink is null");
                        }
                        const action: Action = {
                            step: "click",
                            args: [this.activeLink.selector],
                            reason: "Crawling"
                        }
                        this.bus.emit({ ts: t0, type: "action_started", action: action, agentName: this.name });
                        this.logManager.log(`Acting on ${this.activeLink.description}`, this.buildState(), true);
                        const result = await this.stageHandSession.act(this.activeLink.selector);
                        if (!result.success) {
                            this.logManager.error(`Action failed: ${result.message}`, this.buildState());
                            this.setState(State.START);
                            break;
                        }
                        this.bus.emit({ ts: t0, type: "action_started", action: action, agentName: this.name });
                    } catch (error: unknown) {
                        const err = error as Error;
                        // Real error - propagate it
                        this.logManager.error(`Action failed: ${err.message}`, this.buildState());
                        this.bus.emit({ ts: Date.now(), type: "error", message: String(error), error: (error as Error) });

                        this.setState(State.ERROR);
                        break;
                    }

                    this.setState(State.VALIDATE);
                    break;
                }

                case State.VALIDATE: {
                    const currentUrl = await this.stageHandSession.waitForStableUrl();
                    this.logManager.log(`Validating ${this.currentUrl} vs ${currentUrl}`, this.buildState(), true);
                    const isSameOrigin = isSameOriginWithPath(this.baseUrl, currentUrl);

                    if (this.activeLink) {
                        pageMemory.markLinkVisited(this.currentUrl, this.activeLink.href || this.activeLink.description);
                        this.logManager.log(`Marked link "${this.activeLink.href}" as visited on ${this.currentUrl}`, this.buildState(), true);
                    }

                    if (!isSameOrigin) {
                        // Optional: ensure page is defined before going back
                        try {
                            await this.stageHandSession.goto(this.currentUrl);
                            this.logManager.log(`Navigated back to ${this.currentUrl} after external page nav`, this.buildState(), true);
                            if (!this.activeLink) throw new Error("activeLink is null after external navigation");
                            pageMemory.markLinkVisited(this.currentUrl, this.activeLink.href || this.activeLink.description);
                            this.queue = pageMemory.getAllUnvisitedLinks(this.currentUrl);
                            this.setState(State.START);
                        } catch (err) {
                            this.bus.emit({
                                ts: Date.now(),
                                type: "error",
                                message: `Failed to goBack() after external page nav: ${err instanceof Error ? err.message : String(err)}`,
                                error: err instanceof Error ? err : undefined
                            });
                            this.logManager.error(`Failed to goBack() after external page nav: ${err instanceof Error ? err.message : String(err)}`, this.state);
                            this.setState(State.ERROR);
                        }
                    } else {
                        this.setState(State.DONE);
                        this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.baseUrl, newPage: currentUrl, page: this.page });
                    }
                    break;
                }

                case State.PAUSE:
                case State.WAIT:
                case State.DONE:
                case State.ERROR:
                default:
                    // nothing to do; top-level loop will skip us
                    break;
            }
        } catch (error) {
            this.logManager.error(String(error), this.buildState(), false);
            this.setState(State.ERROR);
        }
    }

    async cleanup(): Promise<void> {
        this.activeLink = null;
        this.queue = [];
        this.goal = "Crawl the given page";
        this.response = "";
    }
}