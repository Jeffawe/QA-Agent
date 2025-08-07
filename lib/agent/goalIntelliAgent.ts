import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { ImageData, StagehandResponse, State } from "../types.js";
import { LogManager } from "../utility/logManager.js";
import { setTimeout } from "node:timers/promises";
import StagehandSession from "../browserAuto/stagehandSession.js";
import { PageMemory } from "../services/memory/pageMemory.js";

export class GoalAgent extends Agent {
    public goal: string;
    private previousPage: string = "";
    private currentPage: string = "";
    private previousActions: string[] = [];
    private lastAction: string = "";
    public hasAchievedGoal: boolean = false;
    public progressDescription: string = "";

    private actionResponse: StagehandResponse | null = null;
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
            LogManager.error(`GoalAgent requires StagehandSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`GoalAgent requires StagehandSession, got ${this.session.constructor.name}`);
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
            this.currentPage = this.previousPage;
            this.stageHandSession.page?.goBack({ waitUntil: "networkidle" });
        }
    }

    async tick(): Promise<void> {
        const page = this.stageHandSession.page;
        if (!page || this.isDone()) return;

        try {
            switch (this.state) {
                case State.START: {
                    (this as any).startTime = performance.now();
                    this.previousPage = this.currentPage;
                    this.currentPage = page.url();
                    if (!this.goal) {
                        LogManager.error("GoalAgent started without a goal", this.buildState());
                        this.setState(State.ERROR);
                        this.bus.emit({
                            ts: Date.now(),
                            type: "stop",
                            message: "GoalAgent started without a goal"
                        });
                        break;
                    }

                    LogManager.log(`GoalAgent started with goal: "${this.goal}"`, this.buildState(), true);
                    this.setState(State.OBSERVE);
                    break;
                }

                case State.OBSERVE: {
                    const filename = `goalagent_${Date.now()}.png`;
                    const finalPath = `images/${filename}`;
                    (this as any).screenshot = finalPath;

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

                    (this as any).elements = await this.stageHandSession.observe();
                    this.setState(State.DECIDE);
                    break;
                }

                case State.DECIDE: {
                    const context = {
                        goal: this.goal,
                        vision: "",
                        lastAction: this.lastAction || null,
                        memory: [...this.previousActions],
                        possibleLabels: (this as any).elements || [],
                    };

                    const imageData: ImageData = {
                        imagepath: (this as any).screenshot
                    };

                    const command = await this.thinker.think(context, imageData, this.name, this.response);

                    if (!command || !command.nextResponse) {
                        LogManager.error("Thinker returned no action", this.state);
                        this.setState(State.ERROR);
                        break;
                    }

                    if (command.analysis) {
                        PageMemory.addAnalysis(this.currentUrl, command.analysis);
                    }

                    this.actionResponse = command.nextResponse;

                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    if (!this.actionResponse) {
                        LogManager.error("No action response to act upon", this.state);
                        this.setState(State.ERROR);
                        break;
                    }
                    const action: string = this.actionResponse?.action || "no_op";

                    if (!action || action === "no_op") {
                        LogManager.log("No action to perform, skipping", this.state);
                        this.setState(State.DONE);
                        break;
                    }

                    if (action === "wait") {
                        LogManager.log("Waiting for a while before next action", this.state);
                        await setTimeout(this.actionResponse?.arguments[0] || 5000);
                        this.setState(State.DONE);
                        break;
                    }

                    try {
                        this.stageHandSession.act(action);
                    } catch (err) {
                        LogManager.error(`Action failed: ${String(err)}`, this.buildState());
                        this.setState(State.ERROR);
                        break;
                    }

                    const endTime = performance.now();
                    this.timeTaken = endTime - (this as any).startTime;

                    await setTimeout(1000);

                    this.goal = this.actionResponse?.nextGoal ?? this.goal;
                    this.progressDescription = this.actionResponse?.progressDescription || "";
                    this.lastAction = this.actionResponse.action;
                    this.previousActions.push(this.lastAction);

                    this.setState(State.DONE);
                    LogManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                    break;
                }

                case State.WAIT:
                case State.VALIDATE:
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
        this.previousActions = [];
        this.progressDescription = "";
        this.goal = "";
        this.state = State.WAIT;
    }
}
