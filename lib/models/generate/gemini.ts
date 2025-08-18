import dotenv from 'dotenv';
import { LLM } from "../../utility/abstract.js";
import { Action, ThinkResult, Namespaces, State } from "../../types.js";
import fs from 'fs';
import path from 'path';
import { getSystemPrompt, getSystemSchema, STOP_LEVEL_ERRORS } from "./prompts.js";
import { generateContent } from "../../externalCall.js";
import { getApiKeyForAgent } from "../../services/memory/apiMemory.js";

import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { EventBus } from "../../services/events/event.js";
import { eventBusManager } from "../../services/events/eventBus.js";
import { LogManager } from "../../utility/logManager.js";
import { logManagers } from "../../services/memory/logMemory.js";

dotenv.config();

export class GeminiLLm extends LLM {
    private genAI: GoogleGenAI | null = null;
    private sessionId: string;
    private apiKey: string | null = null;
    private model: ChatGoogleGenerativeAI | null = null;
    private eventBus: EventBus | null = null;
    private logManager: LogManager;

    constructor(sessionId: string) {
        super();
        this.sessionId = sessionId;
        this.apiKey = getApiKeyForAgent(sessionId) ?? process.env.API_KEY;

        this.logManager = logManagers.getOrCreateManager(sessionId);

        if (!this.apiKey) {
            this.logManager.error('API_KEY is not set. Please set the API_KEY', State.ERROR, true);
            throw new Error('API_KEY is not set. Please set the API_KEY');
        }

        this.eventBus = eventBusManager.getOrCreateBus(sessionId);

        if (!this.apiKey?.startsWith('TEST')) {
            try {
                this.genAI = new GoogleGenAI({ apiKey: this.apiKey });

                this.model = new ChatGoogleGenerativeAI({
                    model: "gemini-2.5-flash",
                    temperature: 0,
                    apiKey: this.apiKey
                });
            } catch (err) {
                this.logManager.error(`Failed to create Googlethis.genAI instance: ${err}`, State.ERROR, true);

                // Emit a stop event as the agent cannot function without the LLM
                this.eventBus.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: `Failed to generate multimodal action: ${err}`,
                });

                this.genAI = null;
            }
        }
    }

    generateImageResponse(prompt: string, image: string): Promise<string> {
        throw new Error("Method not implemented.");
    }
    generateTextResponse(prompt: string): Promise<Action> {
        throw new Error("Method not implemented.");
    }

    /**
       * Multimodal helper – embed an image and a textual prompt in a single call.
       * @param prompt  textual instructions
       * @param imagePath path to png/jpg
       * @param recurrent if true, the page explored has been visited before
       * @returns ThinkResult containing analysis and action
       * @throws Error if the image is not found or if the LLM response is invalid
       */
    async generateOldMultimodalAction(prompt: string, imagePath: string, recurrent: boolean = false, agentName: Namespaces): Promise<ThinkResult> {
        try {
            if (!fs.existsSync(imagePath)) throw new Error(`Image not found at ${imagePath}`);

            const mimeType = path.extname(imagePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
            const base64 = fs.readFileSync(imagePath).toString("base64");
            let response = null;
            const systemInstruction = getSystemPrompt(agentName, recurrent);

            try {
                if (this.apiKey?.startsWith('TEST')) {
                    response = await generateContent({
                        prompt,
                        systemInstruction: systemInstruction,
                        imagePath
                    });
                } else {
                    const image = await this.genAI?.files.upload({
                        file: imagePath,
                    });

                    if (!image || !image.uri) {
                        throw new Error("Failed to upload image to Gemini");
                    }

                    response = await this.genAI?.models.generateContent({
                        model: "gemini-2.5-flash",
                        contents: [
                            createUserContent([
                                prompt,
                                createPartFromUri(image.uri || base64, image.mimeType || mimeType),
                            ]),
                        ],
                        config: {
                            systemInstruction: systemInstruction,
                        }
                    });
                }
            } catch (error) {
                const err = error as Error;

                if (err.message.includes('API key not valid')) {
                    throw new Error('Invalid Gemini API key');
                } else if (err.message.includes('quota')) {
                    throw new Error('Gemini API quota exceeded');
                } else {
                    throw err;
                }
            }

            if (!response || !response.candidates || response.candidates.length === 0) {
                throw new Error("No response from Gemini LLM");
            }

            const content = response.candidates[0]?.content?.parts?.[0]?.text

            if (content) {
                this.eventBus?.emit({
                    ts: Date.now(),
                    type: "llm_call",
                    model_name: "gemini-2.5-flash",
                    promptTokens: prompt.length, // approximate: 1 token ~ 4 characters
                    respTokens: content.length ?? 0, // approximate again
                });
            } else {
                this.eventBus?.emit({
                    ts: Date.now(),
                    type: "llm_call",
                    model_name: "gemini-2.5-flash",
                    promptTokens: prompt.length, // approximate: 1 token ~ 4 characters
                    respTokens: 0, // approximate again
                });
            }

            return recurrent ? this.parseActionFromResponse(content) : this.parseDecisionFromResponse(content);
        }
        catch (error) {
            const err = error as Error;

            const isStopLevel = STOP_LEVEL_ERRORS.some(stopError =>
                err.message.startsWith(stopError) || err.message.includes(stopError)
            );

            if (isStopLevel) {
                this.eventBus?.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: `Failed to generate multimodal action: ${err}`,
                });
            }

            throw err; // rethrow the error for upstream handling
        }
    }


    /**
       * Multimodal helper – embed an image and a textual prompt in a single call.
       * @param prompt  textual instructions
       * @param imagePath path to png/jpg
       * @param recurrent if true, the page explored has been visited before
       * @returns ThinkResult containing analysis and action
       * @throws Error if the image is not found or if the LLM response is invalid
       */
    async generateMultimodalAction(prompt: string, imagePath: string, recurrent: boolean = false, agentName: Namespaces): Promise<ThinkResult> {
        try {
            if (!fs.existsSync(imagePath)) throw new Error(`Image not found at ${imagePath}`);

            const mimeType = path.extname(imagePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
            const base64 = fs.readFileSync(imagePath).toString("base64");
            let response = null;
            const systemInstruction = getSystemPrompt(agentName, recurrent);
            const schema = getSystemSchema(agentName, recurrent);

            try {
                if (this.apiKey?.startsWith('TEST')) {
                    response = await generateContent({
                        prompt,
                        systemInstruction,
                        imagePath
                    });
                } else {
                    const image_url = this.imageToDataUrl(imagePath);
                    const humanMessage = new HumanMessage({
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: image_url } },
                        ],
                    });

                    const messages = [
                        new SystemMessage(systemInstruction),
                        humanMessage,
                    ];

                    const structuredLlm = (this.model as any)?.withStructuredOutput(schema);

                    response = await structuredLlm?.invoke(messages);

                }
            } catch (error) {
                const err = error as Error;

                if (err.message.includes('API key not valid')) {
                    throw new Error('Invalid Gemini API key');
                } else if (err.message.includes('quota')) {
                    throw new Error('Gemini API quota exceeded');
                } else {
                    throw err;
                }
            }

            if (!response) {
                throw new Error("No response from Gemini LLM");
            }

            this.logManager.log(response, State.INFO, true);

            if (response) {
                this.eventBus?.emit({
                    ts: Date.now(),
                    type: "llm_call",
                    model_name: "gemini-2.5-flash",
                    promptTokens: prompt.length, // approximate: 1 token ~ 4 characters
                    respTokens: response.length ?? 0, // approximate again
                });
            } else {
                this.eventBus?.emit({
                    ts: Date.now(),
                    type: "llm_call",
                    model_name: "gemini-2.5-flash",
                    promptTokens: prompt.length, // approximate: 1 token ~ 4 characters
                    respTokens: 0, // approximate again
                });
            }

            console.log(response)
            return recurrent ? this.parseActionFromResponse(response) : this.parseDecisionFromResponse(response);
        }
        catch (error) {
            const err = error as Error;

            const isStopLevel = STOP_LEVEL_ERRORS.some(stopError =>
                err.message.startsWith(stopError) || err.message.includes(stopError)
            );

            if (isStopLevel) {
                this.eventBus?.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: `Failed to generate multimodal action: ${err}`,
                });
            }

            throw err;
        }
    }

    // ---------------- private helpers ----------------
    /**
     * Parses the LLM response to extract the decision-making part.
     * @param raw The raw response from the LLM.
     * @returns An ThinkResult object containing the analysis and action.
     */
    private parseDecisionFromResponse(content: string): ThinkResult {
        try {
            if (!content) throw new Error("No candidates returned");
            const responseText: string | undefined = content.trim();
            if (!responseText) throw new Error("Empty response text");

            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON object found in response");

            return JSON.parse(jsonMatch[0]) as ThinkResult;
        } catch (err) {
            console.error("Failed to parse LLM response:", err);
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
            } satisfies ThinkResult;
        }
    }

    private parseActionFromResponse(content: string): ThinkResult {
        // --- defaults -------------------------------------------------------------
        const defaultResponse: ThinkResult = {
            analysis: { bugs: [], ui_issues: [], notes: "" },
            action: {
                step: "no_op",
                args: [],
                reason: "LLM produced invalid JSON"
            }
        };

        try {
            const text: string | undefined =
                content.trim();
            if (!text) throw new Error("Empty response text");

            // grab the first JSON object that appears in the text
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON object found in response");

            const parsed = JSON.parse(jsonMatch[0]);

            // The model might return either the full ThinkResult
            // or just the Action object; handle both cases gracefully.
            const action: Action = parsed.action ?? parsed;

            return { ...defaultResponse, action };
        } catch (err) {
            console.error("Failed to parse LLM response:", err);
            return defaultResponse; // fall back to the no-op action
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
