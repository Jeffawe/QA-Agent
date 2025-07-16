import { GetNextActionContext, ThinkResult, ImageData, Action, AnalysisResponse, NamespacedState, State, Namespaces } from "../types";
import { EventBus } from "../services/events/event";

export abstract class Thinker {
    protected modelClient: LLM | null = null;

    public loadModel(modelClient: any): void {
        this.modelClient = modelClient;
    }

    abstract think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string, recurrent?: boolean): Promise<ThinkResult>;
}

export abstract class LLM {
    abstract generateImageResponse(prompt: string, image: string): Promise<string>;

    abstract generateTextResponse(prompt: string): Promise<Action>;

    abstract generateMultimodalAction(prompt: string, imagePath: string, recurrent: boolean): Promise<AnalysisResponse>
}

export abstract class Agent {
    /** The “namespace” portion of a NamespacedState, e.g. `"Crawler"` */
    public readonly name: Namespaces;

    /** Current finite-state-machine state */
    public state: State = State.START;

    protected timeTaken = 0;
    protected bus: EventBus | null = null;

    protected constructor(name: Namespaces, bus: EventBus) {
        this.name = name;
        this.bus = bus;
    }

    /** Advance the agent by **exactly one** state transition */
    public abstract tick(): Promise<void>;

    /** Return `true` when the agent has finished all work (or failed) */
    public isDone() { 
        const result = this.state === State.DONE || this.state === State.ERROR;
        if (result) this.cleanup();
        return result;
    }

    /** Convenience: `"Crawler.NAVIGATE"` etc., handy for logging */
    public buildState(): NamespacedState {
        return `${this.name}.${this.state}` as NamespacedState;
    }

    protected setState(next: State) {
        const prev = this.state;
        this.state = next;
        if (this.bus) {
            this.bus.emit({ ts: Date.now(), type: "state_transition", from: prev, to: this.state });
        }
    }

    public abstract cleanup(): Promise<void>;
}