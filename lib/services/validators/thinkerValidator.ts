import { EventBus } from "../events/event.js";
import { GeminiLLm } from "../../models/generate/gemini.js";
import { logManagers } from "../memory/logMemory.js";
import { State } from "../../types.js";

export class ThinkerValidator {
    private numOfTests = 0;
    private maxTests = 1;

    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("thinker_call", evt => this.onAction(sessionId, evt.model, evt.level));
        this.numOfTests = 0;
    }

    private async onAction(sessionId: string, model: string, level: "error" | "info" | "debug" | "warn" | "LLM_error") {
        if (level === "LLM_error") {
            this.bus.emit({
                ts: Date.now(),
                type: "pause_all"
            });

            const logManager = logManagers.getOrCreateManager(sessionId);

            logManager.log(`⚠️ Pausing all agents due to LLM error from model ${model}`, State.PAUSE, true);
            const success = await this.TestModel(model);

            this.numOfTests++;
            if (this.numOfTests >= this.maxTests) {
                logManager.log(`❌ Too many tries, Invalid model configuration for ${model}`, State.ERROR, true);
                this.bus.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: `Invalid model configuration for ${model}`,
                    sessionId: this.sessionId
                });
            }

            if (!success) {
                logManager.log(`❌ Invalid model configuration for ${model}`, State.ERROR, true);
                this.bus.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: `Invalid model configuration for ${model}`,
                    sessionId: this.sessionId
                });
            } else {
                logManager.log(`⚠️ Resuming all agents after model ${model} check passed`, State.RESUME, true);
                this.bus.emit({
                    ts: Date.now(),
                    type: "resume_all"
                });
            }
        }
    }

    private async TestModel(model: string): Promise<boolean> {
        try {
            if (!model || typeof model !== "string") {
                return false;
            }

            if (model == "gemini") {
                let gemini: GeminiLLm | null = new GeminiLLm(this.sessionId);
                try {
                    const result = await gemini.testModel();
                    console.log("Model test result:", result);
                    return result;
                } finally {
                    gemini = null;
                }
            } else {
                return false;
            }
        } catch (error) {
            console.error("Error testing model:", error);
            return false;
        }
    }
}
