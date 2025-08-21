import { setTimeout } from "node:timers/promises";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { LinkInfo, State, ImageData, Action, ActionResult, } from "../types.js";
import { processScreenshot } from "../services/imageProcessor.js";
import { getInteractiveElements } from "../services/UIElementDetector.js";
import { fileExists } from "../utility/functions.js";
import { PageMemory } from "../services/memory/pageMemory.js";
import { CrawlMap } from "../utility/crawlMap.js";
import playwrightSession from "../browserAuto/playWrightSession.js";

export default class Analyzer extends Agent {
    public nextLink: Omit<LinkInfo, 'visited'> | null = null;

    private step = 0;
    private queue: LinkInfo[] = [];
    private goal: string = "";
    private visitedPage: boolean = false;
    private lastAction: string = "";

    private playwrightSession: playwrightSession;

    constructor(dependencies: BaseAgentDependencies) {
        super("analyzer", dependencies);
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.playwrightSession = this.session as playwrightSession;
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
            this.logManager.log("Analyzer is already running or cannot start up", this.buildState(), true);
        }
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof playwrightSession)) {
            this.logManager.error(`Analyzer requires playwrightSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`Analyzer requires playwrightSession, got ${this.session.constructor.name}`);
        }

        this.playwrightSession = this.session as playwrightSession;
    }

    /** One FSM transition */
    public async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        if (!this.playwrightSession.page) return
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
                    await this.playwrightSession.clearAllClickPoints();
                    this.currentUrl = this.playwrightSession.page?.url();
                    const filename = `screenshot_${this.step}_${this.sessionId.substring(0, 10)}.png`;
                    (this as any).finalFilename = `images/annotated_${filename}`;

                    const elements = await getInteractiveElements(this.playwrightSession.page!)
                    if (!this.visitedPage || !(await fileExists((this as any).finalFilename))) {
                        const success = await this.playwrightSession.takeScreenshot("images", filename);
                        if (!success) {
                            this.logManager.error("Screenshot failed", this.state);
                            this.setState(State.DONE);
                            break;
                        }

                        await processScreenshot(`./images/${filename}`, elements);
                    }

                    (this as any).clickableElements = elements;

                    // this.logManager.log(`Elements detected: ${elements.length} are: ${JSON.stringify(elements)}`, this.buildState(), false);

                    this.bus.emit({ ts: Date.now(), type: "screenshot_taken", filename: (this as any).finalFilename, elapsedMs: 0 });

                    this.setState(State.DECIDE);
                    break;
                }

                case State.DECIDE: {
                    const labels = this.queue.map((link) => link.text)
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

                    if (action.step === "click" && !this.checkifLabelValid(action.args[0])) {
                        this.logManager.error("Label is not valid", State.ERROR, false);
                        this.response = "Validator warns that Label provided is not among the valid list. Return done step if there is nothing other to do"
                        this.setState(State.OBSERVE);
                        break;
                    }

                    if (action.step === 'done') {
                        this.setState(State.DONE);
                        const leftovers = PageMemory.getAllUnvisitedLinks(this.currentUrl);
                        leftovers.forEach(l => PageMemory.markLinkVisited(this.currentUrl, l.text || l.href));
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

                    const t0 = Date.now();
                    this.bus.emit({ ts: t0, type: "action_started", action });
                    let result: ActionResult | null = null

                    try {
                        result = await this.actionService.executeAction(action, (this as any).clickableElements, this.buildState());
                    } catch (error) {
                        this.logManager.error(String(error), this.state, false);
                        this.bus.emit({ ts: Date.now(), type: "error", message: String(error), error: (error as Error) });
                        this.setState(State.ERROR);
                        break;
                    }

                    if (this.currentUrl && result.message == "external") {
                        this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.currentUrl, newPage: this.playwrightSession.page.url(), page: this.playwrightSession.page });
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
        return this.queue.map((link) => link.text).includes(label);
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

