import { Thinker } from "../../utility/abstract.js";
import { LogManager } from "../../utility/logManager.js";
import { GeminiLLm } from "../../models/generate/gemini.js";
import { GetNextActionContext, State, ThinkResult, ImageData, Namespaces } from "../../types.js";
import { logManagers } from "../memory/logMemory.js";
import { EventBus } from "../events/event.js";
import { eventBusManager } from "../events/eventBus.js";

const thinkerState = State.DECIDE

export class TestingThinker extends Thinker {
    private logManager: LogManager;
    private eventBus: EventBus;

    constructor(sessionId: string) {
        super();
        this.modelClient = new GeminiLLm(sessionId);
        this.logManager = logManagers.getOrCreateManager(sessionId);
        this.eventBus = eventBusManager.getOrCreateBus(sessionId);
    }

    think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string, agentName: Namespaces, recurrent?: boolean): Promise<ThinkResult> {
        throw new Error("Method not implemented.");
    }
}