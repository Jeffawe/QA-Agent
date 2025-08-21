import { EventBus } from "../events/event.js";
import { GeminiLLm } from "../../models/generate/gemini.js";
import { cat } from "@xenova/transformers";

export class ThinkerValidator {
    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("thinker_call", evt => this.onAction(evt.message, evt.model, evt.level));
    }

    private async onAction(message: string, model: string, level: "error" | "info" | "debug" | "warn" | "LLM_error") {
        if (level === "LLM_error") {
            this.bus.emit({
                ts: Date.now(),
                type: "pause_all"
            });

            const success = await this.TestModel(model);

            if (!success) {
                this.bus.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: `Invalid model configuration for ${model}`,
                    sessionId: this.sessionId
                });
            } else {
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
