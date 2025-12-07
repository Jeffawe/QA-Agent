import { GetNextActionContext, ThinkResult, ImageData, Action, NamespacedState, State, Namespaces, TokenUsage, AnalyzerStatus } from "../types.js";
import { EventBus } from "../services/events/event.js";
import { LogManager } from "./logManager.js";
import { logManagers } from "../services/memory/logMemory.js";
import * as fs from "fs";

type LINK_TYPE = "internal" | "external";

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

    abstract generateMultimodalAction(prompt: string, imagePath: string[], recurrent: boolean, agentName: Namespaces): Promise<ThinkResult>

    /**
     * More accurate token counting using a simple tokenizer approximation
     */
    protected estimateTokens(text: string): number {
        if (!text) return 0;

        // More sophisticated estimation than just character count
        // This accounts for common patterns in text tokenization
        const words = text.trim().split(/\s+/);
        const totalChars = text.length;

        // Average tokens per word is roughly 1.3 for English
        // But also consider character density for non-word tokens
        const wordBasedEstimate = words.length * 1.3;
        const charBasedEstimate = totalChars / 4;

        // Take the higher estimate to be conservative
        return Math.ceil(Math.max(wordBasedEstimate, charBasedEstimate));
    }

    /**
     * Calculate image token usage based on image dimensions and format
     */
    protected calculateImageTokens(imagePaths: string[]): number {
        try {
            let localValue = 0;
            for (const imagePath of imagePaths) {
                const stats = fs.statSync(imagePath);
                const fileSizeKB = stats.size / 1024;

                // Gemini token calculation is complex and depends on:
                // - Image resolution
                // - Image format
                // - Model version

                // For Gemini 2.5 Flash, rough estimates:
                // - Small images (~100KB): ~250-500 tokens
                // - Medium images (~500KB): ~750-1500 tokens  
                // - Large images (1MB+): ~1500-3000 tokens

                if (fileSizeKB < 100) {
                    localValue += 400; // Conservative estimate for small images
                } else if (fileSizeKB < 500) {
                    localValue += Math.ceil(fileSizeKB * 2.5); // ~2.5 tokens per KB
                } else if (fileSizeKB < 1000) {
                    localValue += Math.ceil(fileSizeKB * 2); // ~2 tokens per KB
                } else {
                    localValue += Math.ceil(fileSizeKB * 1.5); // ~1.5 tokens per KB for large images
                }
            }

            return localValue;
        } catch (error) {
            return 1000; // Default conservative estimate
        }
    }

    /**
     * Calculate tokens for structured response
     */
    protected calculateResponseTokens(response: any): number {
        if (!response) return 0;

        let responseText: string;

        if (typeof response === 'string') {
            responseText = response;
        } else if (typeof response === 'object') {
            // For structured responses, convert to JSON string
            responseText = JSON.stringify(response);
        } else {
            responseText = String(response);
        }

        return this.estimateTokens(responseText);
    }

    /**
     * Calculate total token usage for a multimodal request
     */
    protected calculateTokenUsage(
        prompt: string,
        systemInstruction: string,
        imagePaths: string[] | null,
        response: any
    ): TokenUsage {
        const promptTokens = this.estimateTokens(prompt);
        const systemTokens = this.estimateTokens(systemInstruction);
        const imageTokens = imagePaths ? this.calculateImageTokens(imagePaths) : 0;
        let responseTokens = 0;

        if (response) {
            responseTokens = this.calculateResponseTokens(response);
        }


        const totalPromptTokens = promptTokens + systemTokens + imageTokens;

        return {
            promptTokens: totalPromptTokens,
            responseTokens,
            totalTokens: totalPromptTokens + responseTokens,
            imageTokens
        };
    }
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
    protected _state: State = State.START;

    // public read-only access
    public get state(): State {
        return this._state;
    }

    public baseUrl: string | null = null;

    public dependent: boolean = false;

    // Indicates the status of the analyzer
    public analyzerStatus: AnalyzerStatus = AnalyzerStatus.PAGE_NOT_SEEN;

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
    protected uniqueId: string = "";

    protected requiredAgents: Agent[] = [];

    // Default state to go to after a validator warning
    // This is set to START by default, meaning it will reset the agent to the initial state
    protected validatorWarningState: State = this.dependent ? State.WAIT : State.START;
    protected logManager: LogManager;

    protected constructor(name: Namespaces, dependencies: BaseAgentDependencies) {
        this.name = name;
        this.bus = dependencies.eventBus;
        this.session = dependencies.session;
        this.thinker = dependencies.thinker;
        this.actionService = dependencies.actionService;
        this.agentRegistry = dependencies.agentRegistry;
        this.sessionId = dependencies.sessionId;
        this.dependent = dependencies.dependent;
        this.uniqueId = `${this.name}_${this.sessionId}`;

        if (dependencies.dependent) {
            this._state = State.WAIT;
        }

        this.logManager = logManagers.getOrCreateManager(this.sessionId);

        this.bus.on("validator_warning", (evt) => {
            if (evt.agentName === this.name) {
                this.response = evt.message;
                this.logManager.log(`Validator warning in agent ${this.name}: ${evt.message}`, State.WARN, true);
                this.setState(this.validatorWarningState);
            }
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

    /**
     * This method is called on each tick of the agent
    */
    public nextTick(): void { }

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

    public setState(next: State) {
        const prev = this.state;
        this._state = next;
        this.bus.emit({ ts: Date.now(), type: "state_transition", from: prev, to: this._state });

        if (next === State.DONE) {
            this.onDone?.();
        }
    }

    public getState() {
        return this.state
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
        if (this.requiredAgents.length === 0) return;
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
    protected baseUrl: string = '';

    public constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.logManager = logManagers.getOrCreateManager(sessionId);
    }
    public abstract start(url: string): Promise<boolean>;
    public abstract close(): Promise<void>;

    public getSessionId(): string {
        return this.sessionId;
    }

    public abstract goto(newPage: string, oldPage?: string): Promise<void>;
}


export abstract class ActionService {
    protected session: Session;
    protected logManager: LogManager;
    protected intOrext: LINK_TYPE = 'internal';
    protected baseUrl: string = '';

    constructor(session: Session) {
        this.session = session;
        this.logManager = logManagers.getOrCreateManager(session.getSessionId());
    }

    public setBaseUrl(url: string) {
        this.baseUrl = url;
    }
}

function uuidv4(): string {
    throw new Error("Function not implemented.");
}
