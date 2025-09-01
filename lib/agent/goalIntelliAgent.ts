import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { Action, ImageData, State } from "../types.js";
import { setTimeout } from "node:timers/promises";
import StagehandSession from "../browserAuto/stagehandSession.js";
import { PageMemory } from "../services/memory/pageMemory.js";
import AutoActionService from "../services/actions/autoActionService.js";

export class GoalAgent extends Agent {
    public goal: string;
    private previousPage: string = "";
    private currentPage: string = "";
    private previousActions: string[] = [];
    private lastAction: string = "";
    public hasAchievedGoal: boolean = false;
    public progressDescription: string = "";

    private actionResponse: Action | null = null;
    private stageHandSession: StagehandSession;
    private localactionService: AutoActionService;

    constructor(dependencies: BaseAgentDependencies) {
        super("goalagent", dependencies);
        this.goal = "";
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.stageHandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        this.baseUrl = url;
        this.currentUrl = url;
        this.goal = mainGoal || "";
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`GoalAgent requires StagehandSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`GoalAgent requires StagehandSession, got ${this.session.constructor.name}`);
        }

        this.stageHandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`GoalAgent requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`GoalAgent requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
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
        if (this.paused) {
            return;
        }

        const page = this.stageHandSession.page;
        if (!page || this.isDone()) return;

        try {
            switch (this.state) {
                case State.START: {
                    (this as any).startTime = performance.now();
                    this.previousPage = this.currentPage;
                    this.currentPage = page.url();
                    if (!this.goal) {
                        this.logManager.error("GoalAgent started without a goal", this.buildState());
                        this.setState(State.ERROR);
                        this.bus.emit({
                            ts: Date.now(),
                            type: "stop",
                            sessionId: this.sessionId,
                            message: "GoalAgent started without a goal"
                        });
                        break;
                    }

                    this.logManager.log(`GoalAgent started with goal: "${this.goal}"`, this.buildState(), true);
                    this.setState(State.OBSERVE);
                    break;
                }

                case State.OBSERVE: {
                    const filename = `screenshot_${Date.now()}_${this.sessionId.substring(0, 10)}.png`;
                    const finalPath = `images/${filename}`;
                    (this as any).screenshot = finalPath;

                    const success = await this.stageHandSession.takeScreenshot("images", filename);
                    if (!success) {
                        this.logManager.error("Screenshot failed", this.state);
                        this.setState(State.ERROR);
                        this.stopSystem("Screenshot failed");
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

                    if (!command || !command.action) {
                        this.logManager.error("Thinker returned no action", this.state);
                        this.setState(State.ERROR);
                        break;
                    }

                    this.noErrors = command.noErrors ?? false;

                    if (command.analysis) {
                        PageMemory.addAnalysis(this.currentUrl, command.analysis, this.sessionId);
                    }

                    this.actionResponse = command.action;

                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    if (!this.actionResponse) {
                        this.logManager.error("No action response to act upon", this.state);
                        this.setState(State.ERROR);
                        break;
                    }
                    const action: string = this.actionResponse?.step || "no_op";

                    if (!action || action === "no_op") {
                        this.logManager.log("No action to perform, skipping", this.state);
                        this.setState(State.DONE);
                        break;
                    }

                    if (action === "wait") {
                        this.logManager.log("Waiting for a while before next action", this.state);
                        await setTimeout(this.actionResponse?.args[0] || 5000);
                        this.setState(State.DONE);
                        this.noErrors = true;
                        break;
                    }

                    try {
                        this.stageHandSession.act(action);
                    } catch (err) {
                        this.logManager.error(`Action failed: ${String(err)}`, this.buildState());
                        this.setState(State.ERROR);
                        break;
                    }

                    const endTime = performance.now();
                    this.timeTaken = endTime - (this as any).startTime;

                    await setTimeout(1000);

                    this.goal = this.actionResponse?.newGoal ?? this.goal;
                    this.progressDescription = this.actionResponse?.progressDescription || "";
                    this.lastAction = this.actionResponse.step;
                    this.previousActions.push(this.lastAction);

                    this.setState(State.DONE);
                    this.logManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                    break;
                }

                case State.PAUSE:
                case State.WAIT:
                case State.VALIDATE:
                case State.ERROR:
                case State.DONE:
                default:
                    break;
            }
        } catch (err) {
            this.logManager.error(String(err), this.buildState());
            this.setState(State.ERROR);
        }
    }

    async cleanup(): Promise<void> {
        this.previousActions = [];
        this.progressDescription = "";
        this.goal = "";
        this.state = State.WAIT;
        this.lastAction = "";
        this.noErrors = false;
        this.actionResponse = null;
    }
}
