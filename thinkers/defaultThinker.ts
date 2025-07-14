import { Thinker } from "../abstract";
import { GeminiLLm } from "../models/generate/gemini";
import { LogManager } from "../logManager";
import { GetNextActionContext, ThinkResult, ImageData, State } from "../types";
import LLMCommander from "../models/llmModel";
import VisionModel from "../models/visionModel";
import { performance } from 'perf_hooks';

const thinkerState = State.DECIDE

export class DefaultThinker extends Thinker {
    constructor(private vision: VisionModel, private llm: LLMCommander) {
        super();
        this.modelClient = new GeminiLLm();
        this.vision.loadModel(this.modelClient);
        this.llm.loadModel(this.modelClient);
    }

    async think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string): Promise<ThinkResult> {
        const visionStart = performance.now();
        const analysis = await this.vision.analyzeImage(imageData.imagepath, extraInfo);
        const visionEnd = performance.now();
        LogManager.log(`✅ Vision analysis took ${(visionEnd - visionStart).toFixed(2)} ms`);
        LogManager.log(`🔍 Vision analysis result: ${JSON.stringify(analysis)}`, thinkerState, false);

        const llmStart = performance.now();
        const command = await this.llm.getNextAction({
            goal: nextActionContext.goal,
            vision: analysis,
            lastAction: nextActionContext.lastAction,
            memory: nextActionContext.memory,
            possibleLabels: nextActionContext.possibleLabels
        });

        if (!command || !command.step) {
            LogManager.log(`❌ LLM did not return a valid command: ${JSON.stringify(command)}`, thinkerState, false);
            return {
                action: { step: 'no_op', args: [], reason: 'LLM did not return a valid command' }
            };
        }
        
        const llmEnd = performance.now();
        LogManager.log(`✅ LLM reasoning took ${(llmEnd - llmStart).toFixed(2)} ms`);
        LogManager.log(`💬 LLM command: ${JSON.stringify(command)}`, thinkerState, false);

        return {
            action: command || { step: 'no_op', args: [], reason: 'No command returned' }
        };
    }
}