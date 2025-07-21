import Session from "../models/session.js";
import ActionService from "../services/actions/actionService.js";
import { EventBus } from "../services/events/event.js";
import { LinkInfo, NamespacedState, State } from "../types.js";
import { Agent } from "../utility/abstract.js";
import { LogManager } from "../utility/logManager.js";

export interface ManualTesterDependencies {
    session: Session;
    actionService: ActionService;
    eventBus: EventBus;
    canvasSelector?: string;
    state?: NamespacedState;
}

export default class ManualTester extends Agent {
    private readonly session: Session;
    private readonly actionService: ActionService;

    public nextLink: Omit<LinkInfo, 'visited'> | null = null;

    private queue: LinkInfo[] = [];
    private goal: string = "";
    private baseUrl: string = "";
    private currentUrl: string = "";

    constructor({
        session,
        actionService,
        eventBus
    }: ManualTesterDependencies) {
        super("Tester", eventBus);
        this.session = session;
        this.actionService = actionService
        this.state = State.WAIT;
    }

    public setBaseUrl(url: string) {
        this.baseUrl = url;
        this.actionService.setBaseUrl(url);
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
        if (!this.session.page) return
        if (!this.bus) return

        try {
            switch (this.state) {
                /*────────── READY → RUN ──────────*/
                case State.START:
                    (this as any).startTime = performance.now();
                    this.currentUrl = this.session.page!.url();
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
                    const newUrl = new URL(this.session.page.url());

                    const isSameOrigin =
                        oldUrl.protocol === newUrl.protocol &&
                        oldUrl.hostname === newUrl.hostname;

                    if (!isSameOrigin) {
                        // Optional: ensure page is defined before going back
                        try {
                            await this.session.page?.goBack({ waitUntil: "networkidle0" });
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
                        this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.currentUrl, newPage: this.session.page.url(), page: this.session.page });
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