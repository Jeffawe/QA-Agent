import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import dotenv from 'dotenv';
import { LLM } from "../../utility/abstract";
import { Action, AnalysisResponse } from "../../types";
import fs from 'fs';
import path from 'path';
import { systemPrompt, systemActionPrompt } from "./prompts";
import { eventBus } from "../../services/events/eventBus";

dotenv.config();

const genAi = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

export class GeminiLLm extends LLM {
    async generateTextResponse(prompt: string): Promise<Action> {
        const response = await genAi.models.generateContent({
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

        const response = await genAi.models.generateContent({
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
       */
    async generateMultimodalAction(prompt: string, imagePath: string, recurrent: boolean = false): Promise<AnalysisResponse> {
        if (!fs.existsSync(imagePath)) throw new Error(`Image not found at ${imagePath}`);

        const mimeType = path.extname(imagePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
        const base64 = fs.readFileSync(imagePath).toString("base64");

        const image = await genAi.files.upload({
            file: imagePath,
        });

        const response = await genAi.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                createUserContent([
                    prompt,
                    createPartFromUri(image.uri || base64, image.mimeType || mimeType),
                ]),
            ],
            config: {
                systemInstruction: recurrent ? systemActionPrompt : systemPrompt
            }
        });

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
        }else{
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

    // ---------------- private helpers ----------------

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
