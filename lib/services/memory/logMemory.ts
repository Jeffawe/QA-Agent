import { LogManager } from "../../utility/logManager.js";

export class LogBusManager {
    private logManagers = new Map<string, LogManager>();

    getOrCreateManager(sessionId: string): LogManager {
        if (!this.logManagers.has(sessionId)) {
            this.logManagers.set(sessionId, new LogManager(sessionId));
        }
        return this.logManagers.get(sessionId)!;
    }

    getManagerIfExists(sessionId: string): LogManager | undefined {
        return this.logManagers.get(sessionId);
    }

    removeManager(sessionId: string) {
        const bus = this.logManagers.get(sessionId);
        if (bus) {
            this.logManagers.delete(sessionId);
        }
    }

    getAllActiveSessions(): string[] {
        return Array.from(this.logManagers.keys());
    }
}

// Global manager instance
export const logManagers = new LogBusManager();
