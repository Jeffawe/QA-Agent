import { log } from "console";
import { State } from "../../types.js";
import { LogManager } from "../../utility/logManager.js";
import { EventBus } from "../events/event.js";
import { logManagers } from "../memory/logMemory.js";

export class ErrorValidator {
    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("error", evt => this.onAction(evt.message, evt.error));
    }

    private onAction(message: string, error?: Error) {
        const logManager = logManagers.getOrCreateManager(this.sessionId);
        logManager.error(message, State.ERROR, true);
    }
}
