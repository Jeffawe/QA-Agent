import { EventBus, LocalEventBus } from "./event.js";

export class EventBusManager {
    private buses = new Map<string, EventBus>();

    getOrCreateBus(sessionId: string): EventBus {
        if (!this.buses.has(sessionId)) {
            this.buses.set(sessionId, new LocalEventBus());
        }
        return this.buses.get(sessionId)!;
    }

    getBusIfExists(sessionId: string): EventBus | undefined {
        return this.buses.get(sessionId);
    }

    removeBus(sessionId: string) {
        const bus = this.buses.get(sessionId);
        if (bus) {
            bus.removeAllListeners();
            this.buses.delete(sessionId);
        }
    }

    getAllActiveSessions(): string[] {
        return Array.from(this.buses.keys());
    }

    clear() {
        for (const bus of this.buses.values()) {
            bus.removeAllListeners();
        }
        this.buses.clear();
    }
}

// Global manager instance
export const eventBusManager = new EventBusManager();
