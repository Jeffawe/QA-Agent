import { Thinker } from "../../utility/abstract.js";
import { LogManager } from "../../utility/logManager.js";
import { GeminiLLm } from "../../models/generate/gemini.js";
import { GetNextActionContext, State, ThinkResult, ImageData, AnalysisResponse, NamespacedState, Namespaces } from "../../types.js";

const thinkerState: NamespacedState = "tester.DECIDE";

export class CombinedThinker extends Thinker {
    constructor() {
        super();
        this.modelClient = new GeminiLLm();
    }

    async think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string, agentName: Namespaces, recurrent: boolean = false): Promise<ThinkResult> {
        let analysis = null;
        if (agentName === "goalagent") {
            analysis = await this.getNextDecisionGoal(nextActionContext, imageData, recurrent, agentName, extraInfo);
        } else {
            analysis = await this.getNextDecision(nextActionContext, imageData, recurrent, agentName, extraInfo);
        }

        return {
            action: analysis.action || { step: 'no_op', args: [], reason: 'No command returned' },
            pageDetails: analysis.pageDetails || { pageName: "", description: "" },
            analysis: analysis.analysis,
            nextResponse: analysis.nextResponse || { action: "", progressDescription: "", arguments: [], nextGoal: "", hasAchievedGoal: false }
        } satisfies ThinkResult;
    }

    /**
         * Generate next action based on the current state.
         * @param context - The current state context.
         * @param imageData - The image data.
         * @returns The next action for the agent.
    */
    async getNextDecision(context: GetNextActionContext, imageData: ImageData, recurrent: boolean,
        agentName: Namespaces, extraInfo?: string): Promise<AnalysisResponse> {
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

            const result = await this.modelClient.generateMultimodalAction(userMessage, imageData.imagepath, recurrent, agentName);
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

    /**
            * Generate next action based on the current state.
            * @param context - The current state context.
            * @param imageData - The image data.
            * @returns The next action for the agent.
       */
    async getNextDecisionGoal(context: GetNextActionContext, imageData: ImageData, recurrent: boolean, agentName: Namespaces, extraInfo?: string): Promise<AnalysisResponse> {
        if (!this.modelClient) {
            throw new Error("Model client is not loaded. Please load the model first.");
        }

        try {
            const userMessage = `
                    Current Context:
                    - Goal: ${context.goal} (Immediate next task to complete)
                    - Main Goal: ${context.mainGoal} (Full QA goal to complete)
                    - Last Action: ${context.lastAction || "None"}
                    - Memory: ${context.memory.join("; ") || "None"}
                    - Possible Labels: ${context.possibleLabels.join("; ") || "None"}
                    (This is the only list of available UI elements or links. Action must match one of these descriptions.)
                    - Extra Info (Validator Warnings): ${extraInfo || "None"}
    
                    Respond with valid JSON only.
                    `;

            // Use multimodal if we have an image
            if (!imageData?.imagepath) {
                throw new Error("No image data provided.");
            }

            const result = await this.modelClient.generateMultimodalAction(userMessage, imageData.imagepath, recurrent, agentName);
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