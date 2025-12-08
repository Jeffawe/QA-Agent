import { Thinker } from "../../utility/abstract.js";
import { LogManager } from "../../utility/logManager.js";
import { GeminiLLm } from "../../models/generate/gemini.js";
import { GetNextActionContext, State, ThinkResult, ImageData, Namespaces } from "../../types.js";
import { logManagers } from "../memory/logMemory.js";
import { EventBus } from "../events/event.js";
import { eventBusManager } from "../events/eventBus.js";
import { processImages } from "../imageProcessor.js";
import { dataMemory } from "../memory/dataMemory.js";

const thinkerState = State.DECIDE

export class CombinedThinker extends Thinker {
    private logManager: LogManager;
    private eventBus: EventBus;

    constructor(sessionId: string) {
        super();
        this.modelClient = new GeminiLLm(sessionId);
        this.logManager = logManagers.getOrCreateManager(sessionId);
        this.eventBus = eventBusManager.getOrCreateBus();
    }

    async think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string, agentName: Namespaces, recurrent: boolean = false): Promise<ThinkResult> {
        let analysis = null;
        if (agentName === "goalagent") {
            analysis = await this.getNextDecisionGoal(nextActionContext, imageData, recurrent, agentName, extraInfo);
        } else {
            analysis = await this.getNextDecision(nextActionContext, imageData, recurrent, agentName, extraInfo);
        }

        return {
            action: analysis.action || { step: 'no_op', args: [], reason: 'No command returned', hasAchievedGoal: false },
            pageDetails: analysis.pageDetails || { pageName: "", description: "" },
            analysis: analysis.analysis,
            noErrors: analysis.noErrors !== undefined ? analysis.noErrors : true, // Default to true if not specified
        } satisfies ThinkResult;
    }

    /**
         * Generate next action based on the current state.
         * @param context - The current state context.
         * @param imageData - The image data.
         * @returns The next action for the agent.
    */
    async getNextDecision(context: GetNextActionContext, imageData: ImageData, recurrent: boolean,
        agentName: Namespaces, extraInfo?: string): Promise<ThinkResult> {
        if (!this.modelClient) {
            throw new Error("Model client is not loaded. Please load the model first.");
        }

        this.logManager.log(`Generating next action for agent: ${agentName}`, thinkerState, false);

        try {
            const userMessage = `
                Current Context:
                - Goal: ${context.goal}
                - Current Url: ${context.currentUrl}
                - Last Action: ${context.lastAction || "None"}
                - Visited Pages Url's: ${context.visitedPages?.join(", ") || "None"}
                - Memory: ${context.memory.join("; ") || "None"}
                - Possible Actions: ${context.possibleLabels.join(", ") || "None"}
                - Extra Info: ${extraInfo || "None"}

                Respond with valid JSON only.
            `;

            // Use multimodal if we have an image
            if (!imageData?.imagepath) {
                throw new Error("No image data provided.");
            } else {
                const optimize = dataMemory.getData("optimizeimages");
                if (optimize) {
                    imageData.imagepath = await processImages(imageData.imagepath);
                }
            }

            const result = await this.modelClient.generateMultimodalAction(userMessage, imageData.imagepath, recurrent, agentName);
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logManager.error(`Error generating next action: ${errorMessage}`, State.DECIDE, false);
            this.eventBus.emit({
                ts: Date.now(),
                type: "thinker_call",
                level: "LLM_error",
                model: this.modelClient.name,
                message: `Failed to generate multimodal action: ${errorMessage}`,
            });

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
                    possibleActionSelected: ""
                },
                noErrors: false // Indicates that the action was not performed due to an error
            } satisfies ThinkResult;
        }
    }

    /**
            * Generate next action based on the current state.
            * @param context - The current state context.
            * @param imageData - The image data.
            * @returns The next action for the agent.
       */
    async getNextDecisionGoal(context: GetNextActionContext, imageData: ImageData, recurrent: boolean, agentName: Namespaces, extraInfo?: string): Promise<ThinkResult> {
        if (!this.modelClient) {
            throw new Error("Model client is not loaded. Please load the model first.");
        }

        try {
            const userMessage = `
                    Current Context:
                    - Goal: ${context.goal} (Immediate next task to complete)
                    - Current Url: ${context.currentUrl}
                    - Main Goal: ${context.mainGoal} (Full QA goal to complete)
                    - Last Action: ${context.lastAction || "None"}
                    - Memory: ${context.memory.join("; ") || "None"}
                    - Visited Pages Url's: ${context.visitedPages?.join(", ") || "None"}
                    - Possible Actions: ${context.possibleLabels.join("; ") || "None"}
                    (This is the only list of available UI elements or links. Action must match one of these descriptions.)
                    - Extra Info (Validator Warnings): ${extraInfo || "None"}
    
                    Respond with valid JSON only.
                    `;

            // Use multimodal if we have an image
            if (!imageData?.imagepath) {
                throw new Error("No image data provided.");
            } else {
                const optimize = dataMemory.getData("optimizeimages");
                if (optimize) {
                    imageData.imagepath = await processImages(imageData.imagepath);
                }
            }

            const result = await this.modelClient.generateMultimodalAction(userMessage, imageData.imagepath, recurrent, agentName);
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logManager.error(`Error generating next goal: ${errorMessage}`, State.DECIDE, false);
            this.eventBus?.emit({
                ts: Date.now(),
                type: "thinker_call",
                level: "LLM_error",
                model: this.modelClient.name,
                message: `Failed to generate multimodal action: ${errorMessage}`,
            });

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
                    possibleActionSelected: ""
                },
                noErrors: false // Indicates that the action was not performed due to an error
            } satisfies ThinkResult;
        }
    }
}