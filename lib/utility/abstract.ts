import { GetNextActionContext, ThinkResult, ImageData, Action, AnalysisResponse, NamespacedState, State, Namespaces } from "../types.js";
import { EventBus } from "../services/events/event.js";
import ActionService from "../services/actions/actionService.js";
import { LogManager } from "./logManager.js";
import { AgentConfig } from "../agent.js";

export abstract class Thinker {
    protected modelClient: LLM | null = null;

    public loadModel(modelClient: any): void {
        this.modelClient = modelClient;
    }

    abstract think(nextActionContext: GetNextActionContext, imageData: ImageData, agentName: Namespaces, extraInfo: string, recurrent?: boolean): Promise<ThinkResult>;
}

export abstract class LLM {
    abstract generateImageResponse(prompt: string, image: string): Promise<string>;

    abstract generateTextResponse(prompt: string): Promise<Action>;

    abstract generateMultimodalAction(prompt: string, imagePath: string, recurrent: boolean, agentName: Namespaces): Promise<AnalysisResponse>
}

export interface BaseAgentDependencies {
    session: Session;
    thinker: Thinker;
    actionService: ActionService;
    eventBus: EventBus;
    dependent: boolean; // If true, agent won't start until another agent triggers it
    agentRegistry?: AgentRegistry; // Reference to other agents
}

export abstract class Agent {
    public readonly name: Namespaces;
    public state: State = State.START;
    public baseUrl: string | null = null;

    protected currentUrl: string = "";
    protected timeTaken = 0;
    protected bus: EventBus;
    protected session: Session;
    protected thinker: Thinker;
    protected actionService: ActionService;
    protected agentRegistry?: AgentRegistry;
    protected response: string = "";
    protected validatorWarningState: State = State.START;

    protected constructor(name: Namespaces, dependencies: BaseAgentDependencies) {
        this.name = name;
        this.bus = dependencies.eventBus;
        this.session = dependencies.session;
        this.thinker = dependencies.thinker;
        this.actionService = dependencies.actionService;
        this.agentRegistry = dependencies.agentRegistry;

        if (dependencies.dependent) {
            this.state = State.WAIT;
        }

        this.bus.on("validator_warning", (evt) => {
            this.response = evt.message;
            this.setState(this.validatorWarningState);
        });

        this.bus.on('stop', async (evt) => {
            this.setState(State.ERROR);
            LogManager.log(`${this.name} Agent stopped because of ${evt.message}`, State.ERROR, true);
        });

        this.validateSessionType();
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        this.baseUrl = url;
        this.currentUrl = url;
    }

    protected abstract validateSessionType(): void;

    // Helper method to get other agents safely
    protected getAgent<T extends Agent>(name: Namespaces): T | null {
        return this.agentRegistry?.getAgent<T>(name) || null;
    }

    // Helper method to get other agents with type safety
    protected requireAgent<T extends Agent>(name: Namespaces): T {
        const agent = this.getAgent<T>(name);
        if (!agent) {
            LogManager.error(`Required agent '${name}' not found`, this.buildState());
            this.setState(State.ERROR);
            throw new Error(`Required agent '${name}' not found`);
        }
        return agent;
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
}

export abstract class Session<TPage = any> {
    protected sessionId: string;
    public page: TPage | null = null;

    public constructor(sessionId: string) {
        this.sessionId = sessionId;
    }
    public abstract start(url: string): Promise<boolean>;
    public abstract close(): Promise<void>;

    public getSessionId(): string {
        return this.sessionId;
    }
}

export class AgentConfigSet extends Set<AgentConfig> {
    private nameMap = new Map<string, AgentConfig>();

    add(config: AgentConfig): this {
        if (this.nameMap.has(config.name)) {
            throw new Error(`Agent config with name '${config.name}' already exists`);
        }

        this.nameMap.set(config.name, config);
        return super.add(config);
    }

    delete(config: AgentConfig): boolean {
        this.nameMap.delete(config.name);
        return super.delete(config);
    }

    has(config: AgentConfig): boolean {
        return this.nameMap.has(config.name);
    }

    hasByName(name: string): boolean {
        return this.nameMap.has(name);
    }

    getByName(name: string): AgentConfig | undefined {
        return this.nameMap.get(name);
    }

    clear(): void {
        this.nameMap.clear();
        super.clear();
    }
}