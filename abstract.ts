import { GetNextActionContext, ThinkResult, ImageData, Action, AnalysisResponse } from "./types";

export abstract class Thinker {
    protected modelClient: LLM | null = null;

    public loadModel(modelClient: any): void {
        this.modelClient = modelClient;
    }
    
    abstract think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string): Promise<ThinkResult>;
}

export abstract class LLM {
    abstract generateImageResponse(prompt: string, image: string): Promise<string>;

    abstract generateTextResponse(prompt: string): Promise<Action>;

    abstract generateMultimodalAction(prompt: string, imagePath: string): Promise<AnalysisResponse>
}