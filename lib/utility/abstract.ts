import { GetNextActionContext, ThinkResult, ImageData, Action, NamespacedState, State, Namespaces } from "../types.js";
import { EventBus } from "../services/events/event.js";
import { LogManager } from "./logManager.js";
import { logManagers } from "../services/memory/logMemory.js";

export abstract class Thinker {
    protected modelClient: LLM | null = null;

    public loadModel(modelClient: any): void {
        this.modelClient = modelClient;
    }

    abstract think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string, agentName: Namespaces, recurrent?: boolean): Promise<ThinkResult>;
}

export abstract class LLM {
    public name: string;

    constructor(name: string) {
        this.name = name;
    }

    abstract testModel(): Promise<boolean>;

    abstract generateImageResponse(prompt: string, image: string): Promise<string>;

    abstract generateTextResponse(prompt: string): Promise<Action>;

    abstract generateMultimodalAction(prompt: string, imagePath: string, recurrent: boolean, agentName: Namespaces): Promise<ThinkResult>
}

export interface BaseAgentDependencies {
    session: Session;
    thinker: Thinker;
    actionService: ActionService;
    eventBus: EventBus;
    sessionId: string;
    dependent: boolean; // If true, agent won't start until another agent triggers it
    agentRegistry?: AgentRegistry; // Reference to other agents
}

export abstract class Agent {
    public readonly name: Namespaces;
    public state: State = State.START;
    public baseUrl: string | null = null;

    // Indicates if the agent had any errors during its operation
    public noErrors: boolean = false;

    // In case of paused agent. This is the state it will return to when resumed.
    protected pausedState: State = State.START;

    protected currentUrl: string = "";
    protected sessionId: string = "";
    protected timeTaken = 0;
    protected bus: EventBus;
    protected session: Session;
    protected thinker: Thinker;
    protected actionService: ActionService;
    protected agentRegistry?: AgentRegistry;
    protected response: string = "";
    protected paused: boolean = false;

    protected requiredAgents: Agent[] = [];

    // Default state to go to after a validator warning
    // This is set to START by default, meaning it will reset the agent to the initial state
    protected validatorWarningState: State = State.START;
    protected logManager: LogManager;

    protected constructor(name: Namespaces, dependencies: BaseAgentDependencies) {
        this.name = name;
        this.bus = dependencies.eventBus;
        this.session = dependencies.session;
        this.thinker = dependencies.thinker;
        this.actionService = dependencies.actionService;
        this.agentRegistry = dependencies.agentRegistry;
        this.sessionId = dependencies.sessionId;

        if (dependencies.dependent) {
            this.state = State.WAIT;
        }

        this.logManager = logManagers.getOrCreateManager(this.sessionId);

        this.bus.on("validator_warning", (evt) => {
            this.response = evt.message;
            this.logManager.log(`Validator warning in agent ${this.name}: ${evt.message}`, State.WARN, true);
            this.setState(this.validatorWarningState);
        });

        this.bus.on('stop', async (evt) => {
            this.setState(State.ERROR);
            this.logManager.log(`${this.name} Agent stopped because of ${evt.message}`, State.ERROR, true);
        });

        this.validateSessionType();
        this.validateActionService();

    }

    public setBaseValues(url: string, mainGoal?: string): void {
        this.baseUrl = url;
        this.currentUrl = url;
    }

    public pauseAgent(): void {
        if (!this.paused) {
            this.pausedState = this.state;
            this.setState(State.PAUSE);
            this.paused = true;
        }
    }

    public resumeAgent(): void {
        if (this.paused) {
            this.setState(this.pausedState);
            this.logManager.log(`Resuming agent ${this.name} from state ${this.pausedState}`, this.buildState(), true);
            this.pausedState = State.START; // Reset paused state
            this.paused = false;
        }
    }

    protected stopSystem(reason: string): void {
        this.logManager.log(`${this.name} Agent stopped because of ${reason}`, State.ERROR, true);
        this.bus.emit({ ts: Date.now(), type: "stop", message: reason, sessionId: this.sessionId });
        this.setState(State.ERROR);
    }

    public isPaused(): boolean {
        return this.paused;
    }

    protected abstract validateSessionType(): void;

    protected abstract validateActionService(): void;

    // Helper method to get other agents safely
    protected getAgent<T extends Agent>(name: Namespaces): T | null {
        return this.agentRegistry?.getAgent<T>(name) || null;
    }

    // Helper method to get other agents with type safety
    protected requireAgent<T extends Agent>(name: Namespaces): T {
        const agent = this.getAgent<T>(name);
        if (!agent) {
            this.logManager.error(`Required agent '${name}' not found`, this.buildState());
            this.setState(State.ERROR);
            throw new Error(`Required agent '${name}' not found`);
        }

        if (!this.requiredAgents.includes(agent)) {
            this.requiredAgents.push(agent);
        }
        return agent;
    }

    protected log(message: string): void {
        this.logManager.log(message, this.buildState());
    }

    public abstract tick(): Promise<void>;

    public isDone() {
        return this.state === State.DONE || this.state === State.ERROR;
    }

    public buildState(): NamespacedState {
        return `${this.name}.${this.state}` as NamespacedState;
    }

    protected setState(next: State) {
        const prev = this.state;
        this.state = next;
        this.bus.emit({ ts: Date.now(), type: "state_transition", from: prev, to: this.state });

        if (next === State.DONE) {
            this.onDone?.();
        }
    }

    public areDependenciesDone(): boolean {
        for (const agent of this.requiredAgents) {
            if (!agent.isDone()) {
                return false;
            }
        }
        return true;
    }

    public setDependenciesDone() {
        for (const agent of this.requiredAgents) {
            agent.setState(State.DONE);
        }
    }

    // Optional hook for when the agent reaches DONE state
    public onDone?(): void {
        if(this.requiredAgents.length === 0 ) return;
        for (const agent of this.requiredAgents) {
            if (!agent.isDone()) {
                this.logManager.log(`Waiting for required agent ${agent.name} to finish`, this.buildState(), false);
            }
        }

        this.setDependenciesDone();
    }

    public abstract cleanup(): Promise<void>;
}

// Agent Registry for managing agent references
export class AgentRegistry {
    private agents: Map<string, Agent> = new Map();

    register(name: string, agent: Agent): void {
        this.agents.set(name, agent);
    }

    getAgent<T extends Agent>(name: string): T | null {
        const agent = this.agents.get(name);
        return agent as T || null;
    }

    getAllAgents(): Agent[] {
        return Array.from(this.agents.values());
    }

    hasAgent(name: string): boolean {
        return this.agents.has(name);
    }

    clear(): void {
        this.agents.clear();
    }
}

export abstract class Session<TPage = any> {
    protected sessionId: string;
    public page: TPage | null = null;
    protected logManager: LogManager

    public constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.logManager = logManagers.getOrCreateManager(sessionId);
    }
    public abstract start(url: string): Promise<boolean>;
    public abstract close(): Promise<void>;

    public getSessionId(): string {
        return this.sessionId;
    }
}


export abstract class ActionService {
    protected session: Session;
    protected logManager: LogManager;
    protected intOrext: string = '';
    protected baseUrl: string = '';

    constructor(session: Session) {
        this.session = session;
        this.logManager = logManagers.getOrCreateManager(session.getSessionId());
    }

    public setBaseUrl(url: string) {
        this.baseUrl = url;
    }
}