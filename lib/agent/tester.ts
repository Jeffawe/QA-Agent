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

    protected validateSessionType(): void {
        throw new Error("Method not implemented.");
    }

    public tick(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public cleanup(): Promise<void> {
        throw new Error("Method not implemented.");
    }
}