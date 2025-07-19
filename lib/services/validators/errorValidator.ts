import { State } from "../../types.js";
import { LogManager } from "../../utility/logManager.js";
import { EventBus } from "../events/event.js";

export class ErrorValidator {

    constructor(private bus: EventBus) {
        bus.on("error", evt => this.onAction(evt.message, evt.error));
    }

    private onAction(message: string, error?: Error) {
        LogManager.error(`Agent error: ${message}`, State.ERROR, true);
    }
}
