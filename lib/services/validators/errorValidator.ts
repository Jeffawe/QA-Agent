import { State } from "../../types";
import { LogManager } from "../../utility/logManager";
import { EventBus } from "../events/event";

export class ErrorValidator {

    constructor(private bus: EventBus) {
        bus.on("error", evt => this.onAction(evt.message, evt.error));
    }

    private onAction(message: string, error?: Error) {
        LogManager.error(`Agent error: ${message}`, State.ERROR, true);
    }
}
