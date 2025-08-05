import PuppeteerSession from "../browserAuto/session.js";
import { LinkInfo, State } from "../types.js";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { LogManager } from "../utility/logManager.js";

export default class ManualTester extends Agent {
    public nextLink: Omit<LinkInfo, 'visited'> | null = null;
    private puppeteerSession: PuppeteerSession;

    private queue: LinkInfo[] = [];
    private goal: string = "";

    constructor(dependencies: BaseAgentDependencies) {
        super("manualtester", dependencies);
        this.goal = "";
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.puppeteerSession = this.session as PuppeteerSession;
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        this.baseUrl = url;
        this.actionService.setBaseUrl(url);
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof PuppeteerSession)) {
            LogManager.error(`Crawler requires PuppeteerSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`PuppeteerCrawler requires PuppeteerSession, got ${this.session.constructor.name}`);
        }

        this.puppeteerSession = this.session as PuppeteerSession;
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
            LogManager.log("Tester is already running or cannot start up", this.buildState(), true);
        }
    }

    /** One FSM transition */
    public async tick(): Promise<void> {
        if (!this.puppeteerSession.page) return
        if (!this.bus) return

        try {
            switch (this.state) {
                /*────────── READY → RUN ──────────*/
                case State.START:
                    (this as any).startTime = performance.now();
                    this.currentUrl = this.puppeteerSession.page!.url();
                    this.goal = "Find the next best link to click";
                    LogManager.log(`Start testing ${this.queue.length} links`, this.buildState(), true);
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
                    this.nextLink = this.queue.shift()!;
                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    const t0 = Date.now()

                    try {
                        if (!this.nextLink) {
                            throw new Error("nextLink is null");
                        }
                        await this.actionService.clickSelector(this.nextLink.selector);
                    } catch (error) {
                        LogManager.error(String(error), this.state, false);
                        this.bus.emit({ ts: Date.now(), type: "error", message: String(error), error: (error as Error) });
                        this.setState(State.ERROR);
                        break;
                    }

                    this.setState(State.VALIDATE);
                    break;
                }

                case State.VALIDATE: {
                    const oldUrl = new URL(this.currentUrl);
                    const newUrl = new URL(this.puppeteerSession.page.url());

                    const isSameOrigin =
                        oldUrl.protocol === newUrl.protocol &&
                        oldUrl.hostname === newUrl.hostname;

                    if (!isSameOrigin) {
                        // Optional: ensure page is defined before going back
                        try {
                            await this.puppeteerSession.page?.goBack({ waitUntil: "networkidle0" });
                            this.nextLink = null;
                            this.setState(State.START);
                        } catch (err) {
                            this.bus.emit({
                                ts: Date.now(),
                                type: "error",
                                message: `Failed to goBack() after external page nav: ${err instanceof Error ? err.message : String(err)}`,
                                error: err instanceof Error ? err : undefined
                            });
                            this.setState(State.ERROR);
                        }
                    } else {
                        this.setState(State.DONE);
                        this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.currentUrl, newPage: this.puppeteerSession.page.url(), page: this.puppeteerSession.page });
                    }
                    break;
                }

                case State.WAIT:
                case State.DONE:
                case State.ERROR:
                default:
                    // nothing to do; top-level loop will skip us
                    break;
            }
        } catch (error) {
            LogManager.error(String(error), this.buildState(), false);
            this.setState(State.ERROR);
        }
    }

    async cleanup(): Promise<void> {
        this.nextLink = null;
        this.queue = [];
        this.goal = "Crawl the given page";
        this.state = State.START;
        this.response = "";
    }

    getLinkInfoWithoutVisited(
        links: LinkInfo[],
        targetText: string
    ): Omit<LinkInfo, "visited"> | null {
        if (!targetText) return null;
        const found = links.find(link => link.text === targetText);
        if (!found) return null;

        // Return a copy without 'visited'
        const { visited, ...rest } = found;
        return rest;
    }
}