// Due for change to Redis

import { decrypt, EncryptedData } from "./encryption.js";

const sessionApiKeys = new Map();

export const storeSessionApiKey = (sessionId: string, encryptedData: EncryptedData) => {
    sessionApiKeys.set(sessionId, encryptedData);

    // Set TTL - auto-delete after 4 hours
    setTimeout(() => {
        sessionApiKeys.delete(sessionId);
        console.log(`🔑 API key for session ${sessionId} expired and deleted`);
    }, 4 * 60 * 60 * 1000);
};

// Utility function for agents to get their API key
export const getApiKeyForAgent = (sessionId: string) => {
    try {
        const encryptedData = sessionApiKeys.get(sessionId);

        if (!encryptedData) {
            throw new Error(`No API key found for session: ${sessionId}`);
        }

        return decrypt(encryptedData);
    } catch (error) {
        console.error(`❌ Error retrieving API key for session ${sessionId}:`, error);
        throw error;
    }
};