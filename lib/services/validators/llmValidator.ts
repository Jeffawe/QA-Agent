import { State } from "../../types.js";
import { LogManager } from "../../utility/logManager.js";
import { EventBus } from "../events/event.js";

export class LLMUsageValidator {
    private totalPromptTokens = 0;
    private totalRespTokens = 0;

    constructor(private bus: EventBus) {
        bus.on("llm_call", evt => this.onLLMCall(evt.model_name, evt.promptTokens, evt.respTokens));
    }

    private onLLMCall(model_name: string, promptTokens: number, respTokens: number) {
        this.totalPromptTokens += promptTokens;
        this.totalRespTokens += respTokens;

        const totalTokens = promptTokens + respTokens;
        const totalCost = this.estimateCost(promptTokens, respTokens);

        LogManager.log(`[LLMUsage] Prompt: ${promptTokens}, Response: ${respTokens}, Total: ${totalTokens}, Est. Cost: $${totalCost.toFixed(6)}`, State.INFO, false);
        LogManager.log(`[LLMUsage] Cumulative - Prompt: ${this.totalPromptTokens}, Response: ${this.totalRespTokens}, Total: ${this.totalPromptTokens + this.totalRespTokens}, Est. Cost: $${this.estimateCost(this.totalPromptTokens, this.totalRespTokens).toFixed(6)}`, State.INFO, false);
    }

    private estimateCost(promptTokens: number, respTokens: number): number {
        const inputCostPerToken = 0.0000003;
        const outputCostPerToken = 0.0000025;

        return (promptTokens * inputCostPerToken) + (respTokens * outputCostPerToken);
    }
}
