import BossAgent from "../../agent.js";
import { Worker } from 'worker_threads';

interface SessionData {
    worker: Worker;    // Add worker reference
    status: string;
    websocketPort: number;
}

let sessions = new Map<string, SessionData>();

export const getSessions = () => sessions;

export const getSession = (sessionId: string) => {
    return sessions.get(sessionId);
}

export const setSession = (sessionId: string, sessionData: SessionData) => sessions.set(sessionId, sessionData);

export const deleteSession = async (sessionId: string) => {
    const session = getSession(sessionId);
    if (session) {
        session.worker.terminate();
        sessions.delete(sessionId);
    }
};

export const clearSessions = () => sessions.clear();

export const hasSession = (sessionId: string): boolean => sessions.has(sessionId);

export const getSessionSize = () => sessions.size;

export default {
    getSessions,
    getSession,
    setSession,
    deleteSession,
    clearSessions,
    hasSession,
};  