import { Page } from "playwright";
import playwrightSession from "../browserAuto/playWrightSession.js";
import ManualActionService from "../services/actions/actionService.js";
import { pageMemory } from "../services/memory/pageMemory.js";
import { LinkInfo, State } from "../types.js";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { isSameOriginWithPath } from "../utility/functions.js";

export default class ManualAnalyzer extends Agent {
    public activeLink: LinkInfo | null = null;
    private playwrightSession: playwrightSession;
    private localactionService: ManualActionService;

    private queue: LinkInfo[] = [];
    private goal: string = "";
    private page: Page | null = null;

    constructor(dependencies: BaseAgentDependencies) {
        super("manualanalyzer", dependencies);
        this.goal = "";
        this.setState(dependencies.dependent ? State.WAIT : State.START);

        this.playwrightSession = this.session as playwrightSession;
        this.localactionService = this.actionService as ManualActionService;
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        this.baseUrl = url;
        this.localactionService.setBaseUrl(url);
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof playwrightSession)) {
            this.logManager.error(`ManualAnalyzer requires playwrightSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`ManualAnalyzer requires playwrightSession, got ${this.session.constructor.name}`);
        }

        this.playwrightSession = this.session as playwrightSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof ManualActionService)) {
            this.logManager.error(`ManualAnalyzer requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`ManualAnalyzer requires an appropriate action service`);
        }

        this.localactionService = this.actionService as ManualActionService;
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
            this.logManager.log("ManualAnalyzer is already running or cannot start up", this.buildState(), true);
        }
    }

    /** One FSM transition */
    public async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        if(!this.page){
            const page = await this.playwrightSession.getPage();
            if(!page){
                throw new Error("Page not initialized");
            }
            this.page = page;
        }

        if(!this.baseUrl){
            throw new Error("Base URL not initialized");
        }

        if (!this.bus) return

        try {
            switch (this.state) {
                /*────────── READY → RUN ──────────*/
                case State.START:
                    (this as any).startTime = performance.now();
                    this.currentUrl = this.page.url();
                    this.goal = "Find the next best link to click";
                    this.logManager.log(`Start testing ${this.queue.length} links`, this.buildState(), true);
                    if (this.queue.length === 0) {
                        this.setState(State.DONE);
                    } else {
                        this.setState(State.DECIDE);
                    }
                    break;

                case State.DECIDE: {
                    if (this.queue.length === 0) {
                        this.setState(State.DONE);
                        break;
                    }
                    this.activeLink = this.queue.shift()!;
                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    try {
                        if (!this.activeLink) {
                            throw new Error("nextLink is null");
                        }
                        await this.localactionService.clickSelector(this.activeLink.selector);
                    } catch (error) {
                        this.logManager.error(String(error), this.state, false);
                        this.bus.emit({ ts: Date.now(), type: "error", message: String(error), error: (error as Error) });
                        this.setState(State.ERROR);
                        break;
                    }

                    this.setState(State.VALIDATE);
                    break;
                }

                case State.VALIDATE: {
                    const oldUrl = new URL(this.baseUrl);
                    const newUrl = new URL(this.page.url());

                    const isSameOrigin = isSameOriginWithPath(oldUrl.toString(), newUrl.toString());

                    if (!isSameOrigin) {
                        // Optional: ensure page is defined before going back
                        try {
                            await this.page.goBack({ waitUntil: "networkidle" });
                            if (!this.activeLink) throw new Error("nextLink is null after external navigation");
                            pageMemory.removeLink(this.currentUrl, this.activeLink.description);
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
                        this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.baseUrl, newPage: this.page.url(), page: this.page });
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