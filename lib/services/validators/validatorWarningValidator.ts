import { EventBus } from "../events/event.js";

export class ValidatorWarningValidator {
    private lastMessage: string | null = null;
    private repeatCount = 0;
    private readonly maxRepeats = 3; // threshold before triggering stop

    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("validator_warning", evt => this.onAction(evt.message));
    }

    private onAction(message: string) {
        if (this.lastMessage === message) {
            this.repeatCount++;
        } else {
            this.lastMessage = message;
            this.repeatCount = 1;
        }

        if (this.repeatCount >= this.maxRepeats) {
            this.bus.emit({
                ts: Date.now(),
                type: "stop",
                message: `Message "${message}" repeated ${this.repeatCount} times consecutively`,
                sessionId: this.sessionId
            });

            // optionally reset so it doesn’t keep spamming
            this.repeatCount = 0;
            this.lastMessage = null;
        }
    }
}
