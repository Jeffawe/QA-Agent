import { Thinker } from "../../utility/abstract.js";
import { GetNextActionContext, State, ThinkResult, ImageData, Namespaces } from "../../types.js";

const thinkerState = State.DECIDE

export class DefaultThinker extends Thinker {

    constructor(sessionId: string) {
        super();
    }

    think(nextActionContext: GetNextActionContext, imageData: ImageData, extraInfo: string, agentName: Namespaces, recurrent?: boolean): Promise<ThinkResult> {
        throw new Error("Method not implemented.");
    }
}