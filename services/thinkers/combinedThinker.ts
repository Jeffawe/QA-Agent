import { Thinker } from "../../utility/abstract";
import { LogManager } from "../../utility/logManager";
import { GeminiLLm } from "../../models/generate/gemini";
import { StaticMemory } from "../memory/staticMemory";
import { GetNextActionContext, State, ThinkResult, ImageData, AnalysisResponse } from "../../types";

const thinkerState = State.DECIDE

export class CombinedThinker extends Thinker {
    constructor() {
        super();
        this.modelClient = new GeminiLLm();
    }

    async think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string, recurrent: boolean = false): Promise<ThinkResult> {
        const analysis = await this.getNextDecision(nextActionContext, imageData, recurrent, extraInfo);
        return {
            action: analysis.action || { step: 'no_op', args: [], reason: 'No command returned' },
            pageDetails: analysis.pageDetails || { pageName: "", description: "" }
        };
    }

    /**
         * Generate next action based on the current state.
         * @param context - The current state context.
         * @param imageData - The image data.
         * @returns The next action for the agent.
    */
    async getNextDecision(context: GetNextActionContext, imageData: ImageData, recurrent: boolean, extraInfo?: string): Promise<AnalysisResponse> {
        if (!this.modelClient) {
            throw new Error("Model client is not loaded. Please load the model first.");
        }

        try {
            const userMessage = `
                Current Context:
                - Goal: ${context.goal}
                - Last Action: ${context.lastAction || "None"}
                - Memory: ${context.memory.join("; ") || "None"}
                - Possible Labels: ${context.possibleLabels.join("; ") || "None"}
                (When using click action. Put the appropriate label tag (it must be in the list of possible labels provided) for the UI element box in the args list)
                - Extra Info: ${extraInfo || "None"}

                Respond with valid JSON only.
            `;

            // Use multimodal if we have an image
            if (!imageData?.imagepath) {
                throw new Error("No image data provided.");
            }

            const result = await this.modelClient.generateMultimodalAction(userMessage, imageData.imagepath, recurrent);
            LogManager.log(`LLM response: ${JSON.stringify(result)}`, thinkerState, false);
            return result;
        } catch (error) {
            LogManager.error(`Error generating next action: ${error}`, State.DECIDE, false);
            return {
                analysis: {
                    bugs: [],
                    ui_issues: [],
                    notes: "LLM produced invalid JSON"
                },
                action: {
                    step: "no_op",
                    reason: "LLM produced invalid JSON",
                    args: [],
                }
            } satisfies AnalysisResponse;
        }
    }
}