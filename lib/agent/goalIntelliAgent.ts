import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { getInteractiveElements } from "../services/UIElementDetector.js";
import { Action, ImageData, State } from "../types.js";
import { LogManager } from "../utility/logManager.js";
import { processScreenshot } from "../services/imageProcessor.js";
import { setTimeout } from "node:timers/promises";
import StagehandSession from "../browserAuto/stagehandSession.js";

export class GoalAgent extends Agent {
    private goal: string;
    private previousPage: string = "";
    private currentPage: string = "";
    private previousActions: string[] = [];
    private lastAction: string = "";
    public hasAchievedGoal: boolean = false;
    public progressDescription: string = "";

    private stageHandSession: StagehandSession;

    constructor(dependencies: BaseAgentDependencies) {
        super("goalagent", dependencies);
        this.goal = "";
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.stageHandSession = this.session as StagehandSession;
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        this.baseUrl = url;
        this.currentUrl = url;
        this.goal = mainGoal || "";
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            LogManager.error(`Crawler requires PuppeteerSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`PuppeteerCrawler requires PuppeteerSession, got ${this.session.constructor.name}`);
        }

        this.stageHandSession = this.session as StagehandSession;
    }

    public run(goal: string, extraWarnings?: string): void {
        this.goal = goal;
        this.setState(State.START);
        if (extraWarnings) {
            this.response = extraWarnings;
        }
    }

    public reset(): void {
        if (this.currentPage !== this.previousPage) {
            this.previousPage = this.currentPage;
            // Have session reset the page state
            //this.session.resetPageState();
        }
    }

    async tick(): Promise<void> {
        const page = this.stageHandSession.page;
        if (!page || this.isDone()) return;

        try {
            switch (this.state) {
                case State.START: {
                    (this as any).startTime = performance.now();
                    if (!this.goal) {
                        LogManager.error("GoalAgent started without a goal", this.buildState());
                        this.setState(State.ERROR);
                        break;
                    }

                    LogManager.log(`GoalAgent started with goal: "${this.goal}"`, this.buildState(), true);
                    this.setState(State.OBSERVE);
                    break;
                }

                case State.OBSERVE: {
                    const filename = `goalagent_${Date.now()}.png`;
                    const finalPath = `images/annotated_${filename}`;

                    const success = await this.stageHandSession.takeScreenshot("images", filename);
                    if (!success) {
                        LogManager.error("Screenshot failed", this.state);
                        this.setState(State.ERROR);
                        break;
                    }

                    this.bus.emit({
                        ts: Date.now(),
                        type: "screenshot_taken",
                        filename: finalPath,
                        elapsedMs: 0
                    });

                    this.setState(State.DECIDE);
                    break;
                }

                case State.DECIDE: {
                    const labels = (this as any).clickableElements.map((el: any) => el.label || "");

                    const context = {
                        goal: this.goal,
                        vision: "",
                        lastAction: this.lastAction || null,
                        memory: [...this.previousActions],
                        possibleLabels: labels
                    };

                    const imageData: ImageData = {
                        imagepath: (this as any).screenshot
                    };

                    const command = await this.thinker.think(context, imageData, this.name, this.response);

                    if (!command || !command.action) {
                        LogManager.error("Thinker returned no action", this.state);
                        this.setState(State.ERROR);
                        break;
                    }

                    if (command.analysis) {
                        // Optional: page memory analysis for QA logging
                    }

                    (this as any).pendingAction = command.action;
                    this.goal = command.action.newGoal ?? this.goal;

                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    const action: Action = (this as any).pendingAction;
                    this.lastAction = `Action ${action.step}(${action.args.join(",")}) - Reason: ${action.reason}`;
                    this.previousActions.push(this.lastAction);

                    if (action.step === "done") {
                        LogManager.log("GoalAgent completed task", this.buildState(), true);
                        this.setState(State.DONE);
                        break;
                    }

                    const t0 = Date.now();
                    this.bus.emit({ ts: t0, type: "action_started", action });

                    let result;
                    try {
                        result = await this.actionService.executeAction(action, (this as any).clickableElements, this.buildState());
                    } catch (err) {
                        LogManager.error(`Action failed: ${String(err)}`, this.buildState());
                        this.setState(State.ERROR);
                        break;
                    }

                    this.bus.emit({ ts: Date.now(), type: "action_finished", action, elapsedMs: Date.now() - t0 });

                    await setTimeout(1000); // brief delay before re-observing

                    this.setState(State.OBSERVE);
                    break;
                }

                case State.ERROR:
                case State.DONE:
                default:
                    break;
            }
        } catch (err) {
            LogManager.error(String(err), this.buildState());
            this.setState(State.ERROR);
        }
    }

    async cleanup(): Promise<void> {
        this.state = State.START;
        this.previousActions = [];
    }
}
