import { setTimeout } from "node:timers/promises";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { LinkInfo, State, ImageData, Action, ActionResult, } from "../types.js";
import { fileExists } from "../utility/functions.js";
import { PageMemory } from "../services/memory/pageMemory.js";
import { CrawlMap } from "../utility/crawlMap.js";
import StagehandSession from "../browserAuto/stagehandSession.js";
import AutoActionService from "../services/actions/stagehandActionService.js";
import path from "node:path";

export default class AutoAnalyzer extends Agent {
    public nextLink: Omit<LinkInfo, 'visited'> | null = null;

    private step = 0;
    private queue: LinkInfo[] = [];
    private goal: string = "";
    private visitedPage: boolean = false;
    private lastAction: string = "";

    private stagehandSession: StagehandSession;
    private localactionService: AutoActionService;

    constructor(dependencies: BaseAgentDependencies) {
        super("autoanalyzer", dependencies);
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.stagehandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
        this.validatorWarningState = State.OBSERVE;
    }

    /* ───────── external API ───────── */
    /** Crawler (or any agent) calls this to add links to be tested */
    public enqueue(links: LinkInfo[], visitedPage: boolean = false) {
        this.step = 0;
        this.queue = links;
        this.visitedPage = visitedPage;
        if (this.state === State.DONE || this.state === State.WAIT) {
            this.setState(State.START);
        } else {
            this.logManager.log("AutoAnalyzer is already running or cannot start up", this.buildState(), true);
        }
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`AutoAnalyzer requires stagehandSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`AutoAnalyzer requires stagehandSession, got ${this.session.constructor.name}`);
        }

        this.stagehandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`AutoAnalyzer requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`AutoAnalyzer requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
    }

    /** One FSM transition */
    public async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        if (!this.stagehandSession.page) return
        if (!this.bus) return

        try {
            switch (this.state) {
                /*────────── READY → RUN ──────────*/
                case State.START:
                    (this as any).startTime = performance.now();
                    if (this.visitedPage) {
                        this.logManager.log("I Have visited page before", this.buildState(), true);
                    }
                    this.goal = "Crawl the given page";
                    this.step = 0;
                    this.noErrors = false;
                    this.logManager.log(`Start testing ${this.queue.length} links`, this.buildState(), true);
                    if (this.queue.length === 0) {
                        this.setState(State.DONE);
                    } else {
                        this.setState(State.OBSERVE);
                    }
                    break;

                case State.OBSERVE: {
                    this.currentUrl = this.stagehandSession.page?.url();
                    const filename = `screenshot_${this.step}_${this.sessionId.substring(0, 10)}.png`;
                    const expectedPath = path.resolve("images", filename); // Use absolute path

                    if (!this.visitedPage || !(await fileExists(expectedPath))) {
                        const actualPath = await this.stagehandSession.takeScreenshot("images", filename);
                        if (!actualPath) {
                            this.logManager.error("Screenshot failed", this.state);
                            this.setState(State.ERROR);
                            this.stopSystem("Screenshot failed");
                            break;
                        }
                        (this as any).finalFilename = actualPath; // Use the actual returned path
                    } else {
                        (this as any).finalFilename = expectedPath; // Use the expected path if file exists
                    }

                    this.bus.emit({ ts: Date.now(), type: "screenshot_taken", filename: (this as any).finalFilename, elapsedMs: 0 });

                    this.setState(State.DECIDE);
                    break;
                }

                case State.DECIDE: {
                    const labels = this.queue.map((link) => link.description)
                    this.logManager.log(`Remaining links: ${labels.length} are: ${JSON.stringify(labels)}`, this.buildState(), false);
                    const nextActionContext = {
                        goal: this.goal,
                        vision: "",
                        lastAction: this.lastAction || null,
                        memory: [],
                        possibleLabels: labels,
                    };

                    const imageData: ImageData = {
                        imagepath: (this as any).finalFilename,
                    };

                    this.logManager.addMission(nextActionContext.goal);

                    const command = await this.thinker.think(nextActionContext, imageData, this.name, this.response, this.visitedPage);
                    if (!command?.action) {
                        this.logManager.error("Thinker produced no action", this.state, false);
                        this.setState(State.ERROR);
                        break;
                    }

                    this.noErrors = command.noErrors ?? false;

                    if (command.analysis) {
                        PageMemory.addAnalysis(this.currentUrl, command.analysis, this.sessionId);
                    }

                    (this as any).pendingAction = command.action;

                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    const action: Action = (this as any).pendingAction;
                    const t0 = Date.now();
                    this.bus.emit({ ts: t0, type: "action_started", action });

                    if (action.step === 'done') {
                        this.setState(State.DONE);
                        const leftovers = PageMemory.getAllUnvisitedLinks(this.currentUrl);
                        leftovers.forEach(l => PageMemory.markLinkVisited(this.currentUrl, l.description));
                        CrawlMap.recordPage(PageMemory.pages[this.currentUrl], this.sessionId);
                        this.logManager.log("All links have been tested", this.buildState(), true);
                        this.nextLink = null;
                        const endTime = performance.now();
                        this.timeTaken = endTime - (this as any).startTime;
                        this.noErrors = true;

                        this.logManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                        break;
                    }

                    this.lastAction = `Action ${action.step} with args (${action.args.join(",")}) was last taken because of ${action.reason}`;

                    let result: ActionResult | null = null

                    try {
                        const specificLink = this.queue.find(l => l.description === action.step);
                        if (!specificLink) {
                            this.response = `${action.step} is not a valid link. It does not exist in the labels given.`;
                            this.logManager.error(`${action.step} is not a valid link. It does not exist in the labels given..`, this.state, false);
                            this.setState(State.OBSERVE);
                            break;
                        }

                        result = await this.localactionService.executeAction(action, specificLink, this.buildState());
                    } catch (error) {
                        this.logManager.error(String(error), this.state, false);
                        this.bus.emit({ ts: Date.now(), type: "error", message: String(error), error: (error as Error) });
                        this.setState(State.ERROR);
                        break;
                    }

                    if (this.currentUrl && result.message == "external") {
                        this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.currentUrl, newPage: this.stagehandSession.page.url(), page: this.stagehandSession.page });
                    }

                    this.bus.emit({ ts: Date.now(), type: "action_finished", action, elapsedMs: Date.now() - t0 });
                    const newGoal = action.newGoal ?? "Crawl the given page";
                    if (newGoal != "Crawl the given page") {
                        this.logManager.addSubMission(newGoal);
                        this.logManager.addSubMission(this.goal, "done");
                        this.logManager.log(`New Goal set as ${newGoal}`, this.buildState(), false);
                    }

                    this.goal = newGoal;
                    this.step++;
                    await setTimeout(1000);

                    const endTime = performance.now();
                    this.timeTaken = endTime - (this as any).startTime;

                    const nextLabel = action.nextLink || "";

                    // Check if the link has already been visited
                    const alreadyVisited = PageMemory.isLinkVisited(this.currentUrl, nextLabel);
                    if (alreadyVisited) {
                        this.setState(State.DONE);
                        break;
                    }

                    this.nextLink = this.getLinkInfoWithoutVisited(this.queue, action.nextLink || "");

                    if (result && result.message == "internal") {
                        this.setState(State.OBSERVE);
                    } else {
                        this.setState(State.DONE);
                    }

                    this.logManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
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
        this.nextLink = null;
        this.queue = [];
        this.step = 0;
        this.goal = "Crawl the given page";
        this.state = State.WAIT;
        this.lastAction = "";
        this.visitedPage = false;
        this.noErrors = false;
        this.response = "";
    }

    checkifLabelValid(label: string): boolean {
        if (!label) return false;
        return this.queue.map((link) => link.description).includes(label);
    }

    getLinkInfoWithoutVisited(
        links: LinkInfo[],
        targetText: string
    ): Omit<LinkInfo, "visited"> | null {
        if (!targetText) return null;
        const found = links.find(link => link.description === targetText);
        if (!found) return null;

        // Return a copy without 'visited'
        const { visited, ...rest } = found;
        return rest;
    }
}

