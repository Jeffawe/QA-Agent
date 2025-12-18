import dotenv from 'dotenv';
import { LLM } from "../../utility/abstract.js";
import { Action, ThinkResult, Namespaces, State, TokenUsage } from "../../types.js";
import fs from 'fs';
import path from 'path';
import { getSystemPrompt, getSystemSchema, STOP_LEVEL_ERRORS } from "./prompts.js";
import { getApiKeyForAgent } from "../../services/memory/apiMemory.js";

import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { EventBus } from "../../services/events/event.js";
import { eventBusManager } from "../../services/events/eventBus.js";
import { LogManager } from "../../utility/logManager.js";
import { logManagers } from "../../services/memory/logMemory.js";
import { extractErrorMessage } from '../../utility/functions.js';

dotenv.config();

export class GeminiLLm extends LLM {
    private genAI: GoogleGenAI | null = null;
    private sessionId: string;
    private apiKey: string | null = null;
    private model: ChatGoogleGenerativeAI | null = null;
    private eventBus: EventBus | null = null;
    private logManager: LogManager;
    private modelName = "gemini-2.5-flash";

    constructor(sessionId: string) {
        super("gemini");
        this.sessionId = sessionId;
        const key = getApiKeyForAgent(sessionId);

        this.logManager = logManagers.getOrCreateManager(sessionId);

        if (!key) {
            this.logManager.error('API_KEY is not set. Please set the API_KEY', State.ERROR, true);
            throw new Error('API_KEY is not set. Please set the API_KEY');
        }

        this.apiKey = key;

        this.eventBus = eventBusManager.getOrCreateBus();

        if (!this.apiKey?.startsWith('TEST')) {
            try {
                this.genAI = new GoogleGenAI({ apiKey: this.apiKey });

                this.model = new ChatGoogleGenerativeAI({
                    model: this.modelName,
                    temperature: 0,
                    apiKey: this.apiKey
                });
            } catch (err) {
                const errorMessage = extractErrorMessage(err);
                this.logManager.error(`Failed to create Google genAI instance: ${errorMessage}`, State.ERROR, true);

                // Emit a stop event as the agent cannot function without the LLM
                this.eventBus.emit({
                    ts: Date.now(),
                    type: "stop",
                    sessionId: this.sessionId,
                    message: `Failed to generate multimodal action: ${errorMessage}`,
                });

                this.genAI = null;
            }
        }
    }

    async testModel(): Promise<boolean> {
        if (this.genAI === null) {
            this.logManager.error("genAI is null, returning false");
            return false;
        }

        const startTime = Date.now();
        const testPrompt = "Please respond with exactly: 'Model is working correctly'";

        try {
            let response: string | null = null;

            if (this.apiKey?.startsWith('TEST')) {
                const response = "Test Keys are not working. Please use a genuine API_KEY or contact the developer. If you're in local mode, test keys don't work.";
                this.logManager.log(response, State.ERROR, true);
                throw new Error(response);
            } else {
                const messages = [
                    new SystemMessage("You are a helpful assistant. Follow instructions exactly."),
                    new HumanMessage(testPrompt)
                ];

                const result = await this.model?.invoke(messages);
                response = result?.content?.toString() || null;
                console.log("model.invoke result:", result);
            }

            const responseTime = Date.now() - startTime;

            // Try both console.log AND your log manager
            this.logManager.log(`Gemini response is: ${response}, took ${responseTime}ms`, State.INFO, true);

            if (!response) {
                this.logManager.log("Testing Model failed. Got no response, returning false");
                return false;
            }

            // More detailed validation logging
            const lowerResponse = response.toLowerCase();
            const isValidResponse = lowerResponse.includes("model is working");

            return isValidResponse;

        } catch (error) {
            console.error("Error in testModel:", error);
            return false;
        }
    }

    generateImageResponse(prompt: string, image: string): Promise<string> {
        throw new Error("Method not implemented.");
    }
    generateTextResponse(prompt: string): Promise<Action> {
        throw new Error("Method not implemented.");
    }

    /**
 * Multimodal helper – embed multiple images and a textual prompt in a single call.
 * With conversation history for context.
 * @param prompt  textual instructions
 * @param imagePaths array of paths to png/jpg files
 * @param recurrent if true, the page explored has been visited before
 * @param agentName the agent making the request
 * @param includeHistory number of previous exchanges to include (default: 3)
 * @returns ThinkResult containing analysis and action
 * @throws Error if any image is not found or if the LLM response is invalid
 */
    async generateMultimodalAction(
        prompt: string,
        imagePaths: string[],
        recurrent: boolean = false,
        agentName: Namespaces,
        includeHistory: number = 3 // How many previous exchanges to include
    ): Promise<ThinkResult> {
        try {
            // Validate all images exist
            for (const imagePath of imagePaths) {
                if (!fs.existsSync(imagePath)) {
                    throw new Error(`Image not found at ${imagePath}`);
                }
            }

            this.logManager.log(`${imagePaths.length} images passed to the model`, State.INFO, true);

            const systemInstruction = getSystemPrompt(agentName, recurrent);
            const schema = getSystemSchema(agentName, recurrent);
            this.logManager.log(`agentName: ${String(agentName)}, recurrent: ${recurrent}`, State.INFO, true);

            let response = null;

            try {
                if (this.apiKey?.startsWith('TEST')) {
                    throw new Error('Invalid request, There is an issue parsing your test key at the moment')
                } else {
                    // Get conversation history for this agent
                    const history = this.getConversationHistory(agentName, includeHistory);

                    // Build messages array starting with system message
                    const messages: Array<SystemMessage | HumanMessage | AIMessage> = [
                        new SystemMessage(systemInstruction)
                    ];

                    // Add conversation history
                    for (const entry of history) {
                        if (entry.role === 'user') {
                            messages.push(new HumanMessage(entry.content));
                        } else {
                            messages.push(new AIMessage(entry.content));
                        }
                    }

                    // Build current content with text prompt and images
                    const content: Array<{ type: string, text?: string, image_url?: { url: string } }> = [
                        { type: "text", text: prompt }
                    ];

                    // Add all images to the content array
                    for (const imagePath of imagePaths) {
                        const image_url = this.imageToDataUrl(imagePath);
                        content.push({
                            type: "image_url",
                            image_url: { url: image_url }
                        });
                    }

                    // Add current message
                    messages.push(new HumanMessage({ content }));

                    const structuredLlm = (this.model as any)?.withStructuredOutput(schema);
                    response = await structuredLlm?.invoke(messages);

                    // Store this exchange in history
                    this.addToConversationHistory(agentName, prompt, response?.content || response);
                }
            } catch (error) {
                const errorMessage = extractErrorMessage(error);
                if (errorMessage.includes('API key not valid')) {
                    throw new Error('Invalid Gemini API key');
                } else if (errorMessage.includes('quota')) {
                    throw new Error('Gemini API quota exceeded');
                } else {
                    throw error;
                }
            }

            if (!response) {
                throw new Error("No response from Gemini LLM");
            }

            const tokenUsage: TokenUsage = this.calculateTokenUsage(
                prompt,
                systemInstruction,
                imagePaths,
                response.content
            );

            this.eventBus?.emit({
                ts: Date.now(),
                type: "llm_call",
                model_name: this.modelName,
                promptTokens: tokenUsage.promptTokens,
                respTokens: tokenUsage.responseTokens ?? 0,
            });

            const finalContent = response?.content || response;
            const logContent = typeof finalContent === 'string'
                ? finalContent
                : JSON.stringify(finalContent, null, 2);

            this.logManager.log(logContent, State.INFO, true);

            return recurrent
                ? this.parseActionFromResponse(finalContent)
                : this.parseDecisionFromResponse(finalContent);

        } catch (error) {
            const err = extractErrorMessage(error);
            const isStopLevel = STOP_LEVEL_ERRORS.some(stopError =>
                err.startsWith(stopError) || err.includes(stopError)
            );

            if (isStopLevel) {
                this.eventBus?.emit({
                    ts: Date.now(),
                    type: "stop",
                    sessionId: this.sessionId,
                    message: `Failed to generate multimodal action: ${err}`,
                });
            }

            throw err;
        }
    }

    /**
     * Get conversation history for a specific agent
     */
    private getConversationHistory(
        agentName: Namespaces,
        limit: number
    ): Array<{ role: 'user' | 'assistant'; content: string; timestamp: number; agentName: Namespaces }> {
        const key = this.getHistoryKey(agentName);
        const history = this.conversationHistory.get(key) || [];

        // Return last N exchanges (each exchange = user + assistant, so limit * 2)
        return history.slice(-limit * 2);
    }

    /**
     * Add an exchange to conversation history
     */
    private addToConversationHistory(
        agentName: Namespaces,
        userPrompt: string,
        assistantResponse: any
    ): void {
        const key = this.getHistoryKey(agentName);
        const history = this.conversationHistory.get(key) || [];

        // Add user message
        history.push({
            role: 'user',
            content: userPrompt,
            timestamp: Date.now(),
            agentName
        });

        // Add assistant response
        const responseText = typeof assistantResponse === 'string'
            ? assistantResponse
            : JSON.stringify(assistantResponse);

        history.push({
            role: 'assistant',
            content: responseText,
            timestamp: Date.now(),
            agentName
        });

        // Keep only last 20 exchanges (40 messages) to prevent memory bloat
        if (history.length > 40) {
            history.splice(0, history.length - 40);
        }

        this.conversationHistory.set(key, history);
    }

    /**
     * Get history key for an agent (can be per-session or global)
     */
    private getHistoryKey(agentName: Namespaces): string {
        return `${this.sessionId}:${agentName}`;
    }

    /**
     * Clear conversation history for an agent or all agents
     */
    public clearConversationHistory(agentName?: Namespaces): void {
        if (agentName) {
            const key = this.getHistoryKey(agentName);
            this.conversationHistory.delete(key);
            this.logManager.log(`Cleared conversation history for ${agentName}`, State.INFO, true);
        } else {
            this.conversationHistory.clear();
            this.logManager.log('Cleared all conversation history', State.INFO, true);
        }
    }

    // ---------------- private helpers ----------------
    /**
     * Parses the LLM response to extract the decision-making part.
     * @param raw The raw response from the LLM.
     * @returns An ThinkResult object containing the analysis and action.
     */
    private parseDecisionFromResponse(response: any): ThinkResult {
        try {
            // If it's already a structured object, return it
            if (typeof response === 'object' && response !== null &&
                response.analysis && response.action) {
                return response as ThinkResult;
            }

            // If it's a string, parse it
            let content: string;
            if (typeof response === 'string') {
                content = response;
            } else {
                // Shouldn't happen with proper LangChain handling above, but just in case
                throw new Error("Unexpected response format");
            }

            if (!content) throw new Error("No content in response");

            const responseText: string = content.trim();
            if (!responseText) throw new Error("Empty response text");

            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON object found in response");

            return JSON.parse(jsonMatch[0]) as ThinkResult;
        } catch (err) {
            console.error("Failed to parse LLM response:", err);
            throw err;
        }
    }

    private parseActionFromResponse(response: any): ThinkResult {
        const defaultResponse: ThinkResult = {
            analysis: { bugs: [], ui_issues: [], notes: "" },
            action: {
                step: "no_op",
                args: [],
                reason: "LLM produced invalid response format",
                possibleActionSelected: "",
            },
        };

        try {
            // If it's already a structured object, extract the action
            if (typeof response === 'object' && response !== null) {
                if (response.step && response.args && response.reason) {
                    // Response IS the action
                    return { ...defaultResponse, action: response };
                } else if (response.action) {
                    // Response has an action property
                    return { ...defaultResponse, action: response.action };
                }
            }

            // If it's a string, parse it
            let content: string;
            if (typeof response === 'string') {
                content = response;
            } else {
                throw new Error("Unexpected response format");
            }

            const text: string = content.trim();
            if (!text) throw new Error("Empty response text");

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON object found in response");

            const parsed = JSON.parse(jsonMatch[0]);
            const action: Action = parsed.action ?? parsed;

            return { ...defaultResponse, action };
        } catch (err) {
            console.error("Failed to parse LLM response:", err);
            throw err;
        }
    }

    private imageToDataUrl(imagePath: string) {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64String = imageBuffer.toString('base64');
        const extension = path.extname(imagePath).slice(1).toLowerCase();
        const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
        return `data:${mimeType};base64,${base64String}`;
    }
}
