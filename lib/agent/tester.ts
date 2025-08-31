import { LinkInfo, State } from "../types.js";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import AutoActionService from "../services/actions/stagehandActionService.js";
import StagehandSession from "../browserAuto/stagehandSession.js";

export default class Tester extends Agent {
    public nextLink: Omit<LinkInfo, 'visited'> | null = null;

    private step = 0;
    private queue: LinkInfo[] = [];
    private goal: string = "";
    private visitedPage: boolean = false;
    private lastAction: string = "";

    private stagehandSession: StagehandSession;
    private localactionService: AutoActionService;

    constructor(dependencies: BaseAgentDependencies) {
        super("tester", dependencies);
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.stagehandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
    }

    public enqueue(links: LinkInfo[], visitedPage: boolean = false) {
        this.step = 0;
        this.queue = links;
        this.visitedPage = visitedPage;
        if (this.state === State.DONE || this.state === State.WAIT) {
            this.setState(State.START);
        } else {
            this.logManager.log("Tester is already running or cannot start up", this.buildState(), true);
        }
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`Tester requires stagehandSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`Tester requires stagehandSession, got ${this.session.constructor.name}`);
        }

        this.stagehandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`Analyzer requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`Analyzer requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
    }

    public tick(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    async cleanup(): Promise<void> {
        this.nextLink = null;
        this.queue = [];
        this.step = 0;
        this.goal = "Crawl the given page";
        this.state = State.WAIT;
        this.lastAction = "";
        this.visitedPage = false;
        this.response = "";
    }
}