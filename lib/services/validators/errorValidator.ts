import { EventBus } from "../events/event.js";
import { logManagers } from "../memory/logMemory.js";
import { sendDiscordError } from "../../utility/error.js";

export class ErrorValidator {
    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("error", evt => this.onAction(evt.message, evt.error));
    }

    private async onAction(message: string, error?: Error) {
        await sendDiscordError(error || message, { sessionId: this.sessionId, context: 'ErrorValidator', message: message });
    }
}
