import { setTimeout } from "node:timers/promises";
import Session from "../models/session";
import { Agent, Thinker } from "../utility/abstract";
import ActionService from "../services/actions/actionService";
import { EventBus } from "../services/events/event";
import { LinkInfo, NamespacedState, State, ImageData, Action, ActionResult } from "../types";
import { LogManager } from "../utility/logManager";
import { processScreenshot } from "../services/imageProcessor";
import { getInteractiveElements } from "../services/UIElementDetector";
import { fileExists } from "../utility/functions";
import { PageMemory } from "../services/memory/pageMemory";
import { CrawlMap } from "../utility/crawlMap";


export interface TesterDependencies {
    session: Session;
    thinker: Thinker;
    actionService: ActionService;
    eventBus: EventBus;
    canvasSelector?: string;
    state?: NamespacedState;
}

export default class Tester extends Agent {
    private readonly session: Session;
    private readonly thinker: Thinker;
    private readonly actionService: ActionService;

    public nextLink: Omit<LinkInfo, 'visited'> | null = null;

    private step = 0;
    private queue: LinkInfo[] = [];
    private goal: string = "";
    private visitedPage: boolean = false;
    private lastAction: string = "";

    constructor({
        session,
        thinker,
        actionService,
        eventBus
    }: TesterDependencies) {
        super("Tester", eventBus);
        this.session = session;
        this.thinker = thinker
        this.actionService = actionService
        this.state = State.WAIT;
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
                    if (this.visitedPage) {
                        LogManager.log("I Have visited page before", this.buildState(), true);
                    }
                    this.goal = "Crawl the given page";
                    this.step = 0;
                    LogManager.log(`Start testing ${this.queue.length} links`, this.buildState(), true);
                    if (this.queue.length === 0) {
                        this.setState(State.DONE);
                    } else {
                        this.setState(State.OBSERVE);
                    }
                    break;

                case State.OBSERVE: {
                    await this.session.clearAllClickPoints();
                    const filename = `screenshot_${this.step}.png`;
                    (this as any).finalFilename = `images/annotated_${filename}`;

                    const elements = await getInteractiveElements(this.session.page!)
                    if (!this.visitedPage || !(await fileExists((this as any).finalFilename))) {
                        const success = await this.session.takeScreenshot("images", filename);
                        if (!success) {
                            LogManager.error("Screenshot failed", this.state);
                            this.setState(State.DONE);
                            break;
                        }

                        await processScreenshot(`./images/${filename}`, elements);
                    }

                    (this as any).clickableElements = elements;

                    // LogManager.log(`Elements detected: ${elements.length} are: ${JSON.stringify(elements)}`, this.buildState(), false);

                    this.bus.emit({ ts: Date.now(), type: "screenshot_taken", filename: (this as any).finalFilename, elapsedMs: 0 });

                    this.setState(State.DECIDE);
                    break;
                }

                case State.DECIDE: {
                    const labels = this.queue.map((link) => link.text)
                    LogManager.log(`Remaining links: ${labels.length} are: ${JSON.stringify(labels)}`, this.buildState(), false);
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

                    LogManager.addMission(nextActionContext.goal);

                    const command = await this.thinker.think(nextActionContext, imageData, this.response, this.visitedPage);
                    if (!command?.action) {
                        LogManager.error("Thinker produced no action", this.state, false);
                        this.setState(State.ERROR);
                        break;
                    }

                    if(command.analysis) {
                        PageMemory.addAnalysis(this.session.page!.url(), command.analysis);
                    }

                    (this as any).pendingAction = command.action;

                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    const action: Action = (this as any).pendingAction;

                    if (action.step === "click" && !this.checkifLabelValid(action.args[0])) {
                        LogManager.error("Label is not valid", State.ERROR, false);
                        this.response = "Validator warns that Label provided is not among the valid list. Return done step if there is nothing other to do"
                        this.setState(State.OBSERVE);
                        break;
                    }

                    if (action.step === 'done') {
                        this.setState(State.DONE);
                        const leftovers = PageMemory.getAllUnvisitedLinks(this.session.page!.url());
                        leftovers.forEach(l => PageMemory.markLinkVisited(this.session.page!.url(), l.text || l.href));
                        CrawlMap.recordPage(PageMemory.pages[this.session.page!.url()]);
                        LogManager.log("All links have been tested", this.buildState(), true);
                        this.nextLink = null;
                        const endTime = performance.now();
                        this.timeTaken = endTime - (this as any).startTime;

                        LogManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                        break;
                    }

                    this.lastAction = `Action ${action.step} with args (${action.args.join(",")}) was last taken because of ${action.reason}`;

                    const t0 = Date.now();
                    this.bus.emit({ ts: t0, type: "action_started", action });
                    let result: ActionResult | null = null

                    try {
                        result = await this.actionService.executeAction(action, (this as any).clickableElements, this.buildState());
                    } catch (error) {
                        LogManager.error(String(error), this.state, false);
                        this.bus.emit({ ts: Date.now(), type: "error", message: String(error), stack: (error as Error).stack });
                        this.setState(State.ERROR);
                        break;
                    }

                    this.bus.emit({ ts: Date.now(), type: "action_finished", action, elapsedMs: Date.now() - t0 });
                    const newGoal = action.newGoal ?? "Crawl the given page";
                    if (newGoal != "Crawl the given page") {
                        LogManager.addSubMission(this.goal);
                        LogManager.log(`New Goal set as ${this.goal}`, this.buildState(), false);
                    }
                    this.goal = newGoal;
                    this.step++;
                    await setTimeout(1000);

                    const endTime = performance.now();
                    this.timeTaken = endTime - (this as any).startTime;
                    this.nextLink = this.getLinkInfoWithoutVisited(this.queue, action.nextLink || "");

                    if (result && result.message == "internal") {
                        this.setState(State.OBSERVE);
                    } else {
                        this.setState(State.DONE);
                    }

                    LogManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
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
        this.step = 0;
        this.goal = "Crawl the given page";
        this.state = State.START;
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

