import { EventBus } from "../events/event.js";
import { sendDiscordError } from "../../utility/error.js";
import { NamespacedState, State } from "../../types.js";

export class ErrorValidator {
    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("error", evt => this.onAction(evt.message, evt.buildState, evt.error));
    }

    private async onAction(message: string, buildState: NamespacedState | State, error?: Error) {
        await sendDiscordError(error || message, { sessionId: this.sessionId, context: 'ErrorValidator', message: message, buildState: buildState });
    }
}
