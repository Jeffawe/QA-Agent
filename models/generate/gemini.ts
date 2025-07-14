import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import dotenv, { config } from 'dotenv';
import { LLM } from "../../abstract";
import { Action, AnalysisResponse } from "../../types";
import fs from 'fs';
import path from 'path';
import { LogManager } from "../../logManager";

dotenv.config();

const genAi = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

const systemPrompt = String.raw`
            You are a website-auditing autonomous agent.

            ▸ MISSION
            Your current mission will be given as goal. (external redirects are forbidden except for the login flow).
            For **each page you land on**, do two things:

                1. Analyse—
                • Look for functional bugs (broken links, console errors, 404s, JS exceptions)
                • Flag UX / UI issues (misaligned elements, unreadable contrast, missing alt text, CLS jank, etc.)
                • Note performance hints (large images, long TTFB)
                • Record any helpful contextual info (page purpose, detected frameworks, etc.)

                2. Decide the single next navigation / interaction that keeps the crawl moving inside the site.

            ▸ RESOURCES YOU HAVE
            • Screenshot of the full page (inline image) labelled for the different UI elements
            • Your last action and a short-term memory of prior attempts
            • A list of possible labels to pick from (UI elements in the page. Don't pick outside of it when using click)

            ▸ ALLOWED COMMANDS (one per response)
            - click (buttons, links)
            - scroll (up/down)
            - type (text input, search fields)
            - navigate (back to a previous page / forward in args)
            - wait
            - done   (when the entire site has been audited)

            Arguments for each command should be in the args array.

            ▸ RESPONSE FORMAT  
            Return **exactly one** JSON object, no commentary, in this schema:

            \`\`\`json
            {
                "analysis": {
                    "bugs": [
                        { "description": "...", "selector": "#btn-signup", "severity": "high" }
                    ],
                    "ui_issues": [
                        { "description": "...", "selector": ".nav", "severity": "medium" }
                    ],
                    "notes": "Any extra observations about this page"
                },
                "action": {
                    "step": "command_name",
                    "args": [/* arguments */],
                    "reason": "Why this command keeps the crawl progressing"
                },
                "pageDetails": {
                    pageName: "Name of the page you are currently on",
                    description: "Short description of the page you are currently on"
                }
            }
            \`\`\`
            `;

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
    async generateMultimodalAction(prompt: string, imagePath: string): Promise<AnalysisResponse> {
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
                systemInstruction: systemPrompt
            }
        });

        if (!response || !response.candidates || response.candidates.length === 0) {
            throw new Error("No response from Gemini LLM");
        }
        
        return this.parseActionFromResponse(response);
    }

    // ---------------- private helpers ----------------

    private parseActionFromResponse(raw: any): AnalysisResponse {
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
}
