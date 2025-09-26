import { LogManager } from "../../utility/logManager.js";

export class LogBusManager {
    private logManager : LogManager | null = null;

    getOrCreateManager(sessionId: string): LogManager {
        try {
            if (!this.logManager) {
                this.logManager = new LogManager(sessionId);
            }
            return this.logManager;
        } catch (error) {
            throw error;
        }
    }

    getManagerIfExists(sessionId: string): LogManager | undefined {
        return this.logManager || undefined;
    }

    removeManager(sessionId: string) {
        if (this.logManager) {
            this.logManager = null;
        }
    }

    clear() {
        this.logManager = null;
    }
}

// Global manager instance
export const logManagers = new LogBusManager();
