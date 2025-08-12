import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genAI";
import dotenv from 'dotenv';
import { LLM } from "../../utility/abstract.js";
import { Action, AnalysisResponse, Namespaces, State } from "../../types.js";
import fs from 'fs';
import path from 'path';
import { getSystemPrompt, getActionPrompt, STOP_LEVEL_ERRORS } from "./prompts.js";
import { eventBus } from "../../services/events/eventBus.js";
import { LogManager } from "../../utility/logManager.js";
import { generateContent } from "../../externalCall.js";
import { getApiKeyForAgent } from "../../apiMemory.js";

dotenv.config();

export class GeminiLLm extends LLM {
    private genAI: GoogleGenAI | null = null;
    private sessionId: string;
    private apiKey: string | null = null;

    constructor(sessionId: string) {
        super();
        this.sessionId = sessionId;
        this.apiKey = getApiKeyForAgent(sessionId) ?? process.env.API_KEY;
        if (!this.apiKey) {
            LogManager.error('API_KEY is not set. Please set the API_KEY', State.ERROR, true);
            throw new Error('API_KEY is not set. Please set the API_KEY');
        }

        if (!this.apiKey?.startsWith('TEST')) {
            try {
                this.genAI = new GoogleGenAI({ apiKey: this.apiKey });
            } catch (err) {
                LogManager.error(`Failed to create Googlethis.genAI instance: ${err}`, State.ERROR, true);

                // Emit a stop event as the agent cannot function without the LLM
                eventBus.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: `Failed to generate multimodal action: ${err}`,
                });

                this.genAI = null;
            }
        }
    }

    async generateTextResponse(prompt: string): Promise<Action> {
        const response = await this.genAI?.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                { text: prompt }
            ]
        });

        try {
            if (!response || !response.candidates || response.candidates.length === 0) {
                throw new Error("No response from Gemini LLM");
            }

            const responseText = response.candidates[0]?.content?.parts?.[0]?.text;
            if (!responseText) {
                throw new Error("No text found in LLM response");
            }

            // Clean up the response to extract JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const action: Action = JSON.parse(jsonMatch[0]);
            return action;
        } catch (err) {
            console.error('Failed to parse LLM response:', err);
            return {
                step: 'no_op',
                args: [],
                reason: 'LLM failed to generate valid JSON. Defaulting to no_op.',
            };
        }
    }

    async generateImageResponse(prompt: string, image: string): Promise<string> {
        const contents = [
            {
                inlineData: {
                    mimeType: "image/jpeg",
                    data: image,
                },
            },
            { text: prompt },
        ];

        const response = await this.genAI?.models.generateContent({
            model: "gemini-2.5-flash",
            contents: contents,
        });

        if (!response || !response.text) throw new Error("No response from Gemini LLM");
        return response.text;
    }

    /**
       * Multimodal helper – embed an image and a textual prompt in a single call.
       * @param prompt  textual instructions
       * @param imagePath path to png/jpg
       * @param recurrent if true, the page explored has been visited before
       * @returns AnalysisResponse containing analysis and action
       * @throws Error if the image is not found or if the LLM response is invalid
       */
    async generateMultimodalAction(prompt: string, imagePath: string, recurrent: boolean = false, agentName: Namespaces): Promise<AnalysisResponse> {
        try {
            if (!fs.existsSync(imagePath)) throw new Error(`Image not found at ${imagePath}`);

            const mimeType = path.extname(imagePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
            const base64 = fs.readFileSync(imagePath).toString("base64");
            let response = null;

            if (!this.genAI) {
                throw new Error("Gemini API client cannot be initialized. Please check your API key.");
            }

            try {
                if (this.apiKey?.startsWith('TEST')) {
                    try {
                        response = await generateContent({
                            prompt,
                            systemInstruction: recurrent ? getActionPrompt(agentName) : getSystemPrompt(agentName),
                            imagePath
                        });
                    } catch (error) {
                        const err = error as Error;
                        LogManager.error(`Failed to make test call to server: ${err.message}`, State.ERROR, true);
                        throw err;
                    }
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
                            systemInstruction: recurrent ? getActionPrompt(agentName) : getSystemPrompt(agentName),
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

            if (response.candidates[0]?.content?.parts?.[0]?.text) {
                eventBus.emit({
                    ts: Date.now(),
                    type: "llm_call",
                    model_name: "gemini-2.5-flash",
                    promptTokens: prompt.length, // approximate: 1 token ~ 4 characters
                    respTokens: response.candidates[0].content.parts[0]?.text?.length ?? 0, // approximate again
                });
            } else {
                eventBus.emit({
                    ts: Date.now(),
                    type: "llm_call",
                    model_name: "gemini-2.5-flash",
                    promptTokens: prompt.length, // approximate: 1 token ~ 4 characters
                    respTokens: 0, // approximate again
                });
            }

            return recurrent ? this.parseActionFromResponse(response) : this.parseDecisionFromResponse(response);
        }
        catch (error) {
            const err = error as Error;

            const isStopLevel = STOP_LEVEL_ERRORS.some(stopError =>
                err.message.startsWith(stopError) || err.message.includes(stopError)
            );

            if (isStopLevel) {
                eventBus.emit({
                    ts: Date.now(),
                    type: "stop",
                    message: `Failed to generate multimodal action: ${err}`,
                });
            }

            throw err; // rethrow the error for upstream handling
        }
    }

    // ---------------- private helpers ----------------
    /**
     * Parses the LLM response to extract the decision-making part.
     * @param raw The raw response from the LLM.
     * @returns An AnalysisResponse object containing the analysis and action.
     */
    private parseDecisionFromResponse(raw: any): AnalysisResponse {
        try {
            if (!raw?.candidates?.length) throw new Error("No candidates returned");
            const responseText: string | undefined = raw.candidates[0]?.content?.parts?.[0]?.text;
            if (!responseText) throw new Error("Empty response text");

            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON object found in response");

            return JSON.parse(jsonMatch[0]) as AnalysisResponse;
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
            } satisfies AnalysisResponse;
        }
    }

    private parseActionFromResponse(raw: any): AnalysisResponse {
        // --- defaults -------------------------------------------------------------
        const defaultResponse: AnalysisResponse = {
            analysis: { bugs: [], ui_issues: [], notes: "" },
            action: {
                step: "no_op",
                args: [],
                reason: "LLM produced invalid JSON"
            }
        };

        try {
            const text: string | undefined =
                raw?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error("Empty response text");

            // grab the first JSON object that appears in the text
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON object found in response");

            const parsed = JSON.parse(jsonMatch[0]);

            // The model might return either the full AnalysisResponse
            // or just the Action object; handle both cases gracefully.
            const action: Action = parsed.action ?? parsed;

            return { ...defaultResponse, action };
        } catch (err) {
            console.error("Failed to parse LLM response:", err);
            return defaultResponse; // fall back to the no-op action
        }
    }
}
