import { EventBus, LocalEventBus } from "./event.js";

export class EventBusManager {
    private bus: EventBus | null = null;

    getOrCreateBus(): EventBus {
        if (!this.bus) {
            this.bus = new LocalEventBus();
        }
        return this.bus;
    }

    getBusIfExists(): EventBus | undefined {
        return this.bus || undefined;
    }

    removeBus(): void {
        if (this.bus) {
            this.bus.removeAllListeners();
            this.bus = null;
        }
    }

    clear() {
        this.removeBus();
    }
}

// Global manager instance
export const eventBusManager = new EventBusManager();
