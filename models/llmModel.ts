import { LLM } from '../abstract';
import { Action } from '../types';
import { GetNextActionContext } from '../types';

export default class LLMCommander {
    private modelClient: LLM | null;

    constructor() {
        this.modelClient = null
    }

    loadModel(model: LLM): void {
        try {
            this.modelClient = model;
        } catch (error) {
            console.error('Error loading model:', error);
            throw error;
        }
    }

    /**
     * Generate next action based on the current state.
     * @param context - The current state context.
     * @returns The next action for the agent.
     */
    async getNextAction(context: GetNextActionContext): Promise<Action> {
        const systemPrompt = `
            You are a visual game-playing agent.

            Your high-level goal is: "${context.goal}".

            You only have access to:
            - The current screen description (from vision)
            - Your last action
            - A small memory of past attempts
            - Bounding box data for clickable/interactive elements

            You must issue ONE command at a time to help achieve the goal. You CANNOT issue multiple commands.

            Allowed commands:
            - move_mouse_to(x, y)
            - click(x, y)
            - press_key("key")
            - wait(ms)
            - no_op

            Respond with a single JSON object in the following format:

            {
                "step": "command_name",
                "args": [...arguments],
                "reason": "Why you're doing this"
                "response": "Any response to mention to the vision model that you need to see to make a decision"
            }

            Use ONLY valid commands and give clear, simple reasons. I've also given some Data on bounding box info of the image with labels. The vision model analysis
            should mention the label as well as what the label is used for. Your clicks should be based off info in the boxData (your args should be based off the x and y in boxData).
            `;

        if (!this.modelClient) {
            throw new Error("Model client is not loaded. Please load the model first.");
        }

        const userMessage = `
            ${systemPrompt}
            
            Current Context:
            - Goal: ${context.goal}
            - Vision Analysis: ${context.vision}
            - Last Action: ${context.lastAction || 'None'}
            - Memory: ${context.memory || 'None'}
            - Box Data: ${JSON.stringify(context.boxData)}
            
            What should I do next? Respond with valid JSON only.
        `;

        try{
            const response = await this.modelClient.generateTextResponse(userMessage);
            return response;
        }catch (error) {
            console.error('Error generating next action:', error);
            throw error;
        }
    }
}