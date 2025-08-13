import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { encrypt, storeSessionApiKey } from './apiMemory';

const API_ENDPOINT = 'https://qa-node-backend.onrender.com';

export const setAPIKey = (key: string): boolean => {
    if (!key) {
        throw new Error('API key is required');
    }

    if (!key.startsWith('TEST')) {
        return false;
    }

    process.env.API_KEY = key;
    return true;
}

interface GeminiCallOptions {
    prompt: string;
    systemInstruction: string;
    imagePath?: string;
}

export const generateContent = async (options: GeminiCallOptions) => {
    if (!process.env.API_KEY) {
        throw new Error('API key is not set');
    }

    try {
        const formData = new FormData();
        formData.append('prompt', options.prompt);
        formData.append('systemInstruction', options.systemInstruction);

        if (options.imagePath) {
            if (!fs.existsSync(options.imagePath)) {
                throw new Error(`Image not found at ${options.imagePath}`);
            }

            const mimeType = path.extname(options.imagePath).toLowerCase() === ".png"
                ? "image/png"
                : "image/jpeg";

            formData.append('image', fs.createReadStream(options.imagePath), {
                filename: path.basename(options.imagePath),
                contentType: mimeType,
            });
        }

        const response = await axios.post(
            `${API_ENDPOINT}/api/user/${process.env.API_KEY}/gemini-call`,
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'Content-Length': formData.getLengthSync(),
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            }
        );

        return response.data.response;
    } catch (error: any) {
        if (error.response) {
            const errMsg = error.response.data?.error || error.message;
            if (error.response.status === 429) {
                throw new Error(`API limit exceeded: ${errMsg}`);
            } else if (error.response.status === 401) {
                throw new Error(`Invalid API key: ${errMsg}`);
            } else if (error.response.status === 415) {
                throw new Error(`Failed to upload image to Gemini: ${errMsg}`);
            }
            throw new Error(`API error: ${errMsg}`);
        }
        throw new Error(`Network error: ${error.message}`);
    }
};

export const checkUserKey = async (sessionId: string, userKey: string, returnApiKey = false) : Promise<boolean> => {
    try {
        const response = await fetch(`${API_ENDPOINT}/api/user/check-key`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userKey,
                returnApiKey
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to check user key');
        }

        if (returnApiKey && data.apiKey) {
            const encryptedData = encrypt(data.apiKey);

            // Store encrypted key mapped to sessionId
            storeSessionApiKey(sessionId, encryptedData);
        }

        return data.exists as boolean;
    } catch (error) {
        console.error('Error checking user key:', error);
        throw error;
    }
};