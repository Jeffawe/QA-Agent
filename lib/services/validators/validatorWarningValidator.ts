import { Namespaces } from "../../types.js";
import { EventBus } from "../events/event.js";

export class ValidatorWarningValidator {
    // Track warnings per agent
    private agentWarnings = new Map<string, {
        lastMessage: string;
        repeatCount: number;
    }>();
    
    private readonly maxRepeats = 3; // threshold before triggering stop

    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("validator_warning", evt => this.onAction(evt.message, evt.agentName));
    }

    private onAction(message: string, agentName: Namespaces | "all") {
        const agentKey = agentName || "unknown";
        
        // Get or create tracking for this agent
        const agentData = this.agentWarnings.get(agentKey) || {
            lastMessage: "",
            repeatCount: 0
        };

        if (agentData.lastMessage === message) {
            agentData.repeatCount++;
        } else {
            agentData.lastMessage = message;
            agentData.repeatCount = 1;
        }

        // Update the map
        this.agentWarnings.set(agentKey, agentData);

        if (agentData.repeatCount >= this.maxRepeats) {
            this.bus.emit({
                ts: Date.now(),
                type: "stop",
                message: `Agent "${agentKey}" repeated warning "${message}" ${agentData.repeatCount} times consecutively`,
                sessionId: this.sessionId
            });
            
            // Reset for this agent
            this.agentWarnings.delete(agentKey);
        }
    }

    // Optional: Method to reset a specific agent's tracking
    public resetAgent(agentName: Namespaces | "all"): void {
        this.agentWarnings.delete(agentName);
    }

    // Optional: Method to reset all tracking
    public resetAll(): void {
        this.agentWarnings.clear();
    }
}