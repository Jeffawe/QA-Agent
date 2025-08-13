import { LinkInfo, State } from "../types";
import { Agent, BaseAgentDependencies } from "../utility/abstract";
import playwrightSession from "../browserAuto/playWrightSession.js";

export default class Tester extends Agent {
    public nextLink: Omit<LinkInfo, 'visited'> | null = null;

    private step = 0;
    private queue: LinkInfo[] = [];
    private goal: string = "";
    private visitedPage: boolean = false;
    private lastAction: string = "";

    private playwrightSession: playwrightSession;

    constructor(dependencies: BaseAgentDependencies) {
        super("tester", dependencies);
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.playwrightSession = this.session as playwrightSession;
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
        if (!(this.session instanceof playwrightSession)) {
            this.logManager.error(`Tester requires playwrightSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`Tester requires playwrightSession, got ${this.session.constructor.name}`);
        }

        this.playwrightSession = this.session as playwrightSession;
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