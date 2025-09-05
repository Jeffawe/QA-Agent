import WebSocket, { WebSocketServer } from 'ws';
import { EventBus } from './event.js';
import { PageDetails } from '../../types.js';
import { LogManager } from '../../utility/logManager.js';
import { logManagers } from '../memory/logMemory.js';
import { PageMemory } from '../memory/pageMemory.js';

interface WebSocketData {
    message?: string;
    timestamp: number;
    page?: PageDetails;
}

// Add interface for connection message data
interface ConnectionData {
    status: string;
    message: string;
}

interface FirstConnectionData {
    pages: PageDetails[];
    messages: string[];
    timestamp: number;
}

// Add interface for the complete message structure
interface WebSocketMessage {
    type: string;
    data: WebSocketData | ConnectionData | FirstConnectionData;
    timestamp: string;
}

export class WebSocketEventBridge {
    private clients: Set<WebSocket>;
    private wss: WebSocketServer;
    private logManager: LogManager
    private port: number;
    private readyPromise: Promise<void>;
    private isReady: boolean = false;

    constructor(private eventBus: EventBus, private sessionId: string, port: number) {
        this.eventBus = eventBus;
        this.clients = new Set();
        this.logManager = logManagers.getOrCreateManager(sessionId);
        this.port = port;

        // Create WebSocket server
        this.wss = new WebSocketServer({ port: this.port });

        // Create a promise that resolves when the server is ready
        this.readyPromise = new Promise((resolve, reject) => {
            // Wait for the server to start listening
            this.wss.on('listening', () => {
                // NOW get the actual port
                const address = this.wss.address();
                if (address && typeof address === 'object') {
                    this.port = address.port;
                }
                console.log(`🚀 WebSocket server started on port ${this.port}`);
                this.isReady = true;
                resolve();
            });

            this.wss.on('error', (error) => {
                console.error('❌ WebSocket server error:', error);
                reject(error);
            });
        });

        // Set up the rest after the promise is created
        this.setupConnectionHandlers();
        this.setupEventListeners();
    }

    // Separate method for connection handling
    private setupConnectionHandlers() {
        // Handle new client connections
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('📞 New frontend client connected');
            this.clients.add(ws);

            // Send welcome message
            this.sendToClient(ws, 'CONNECTION', {
                status: 'connected',
                message: 'WebSocket connected successfully'
            });

            this.sendToClient(ws, 'INITIAL_DATA', {
                messages: this.logManager.getLogs(),
                pages: PageMemory.getAllPages(),
                timestamp: Date.now()
            });

            // Handle client disconnect
            ws.on('close', () => {
                console.log('🔌 Client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error: Error) => {
                console.error('❌ WebSocket error:', error);
                this.clients.delete(ws);
            });
        });
    }

    // Method to wait for the server to be ready
    async waitForReady(): Promise<void> {
        await this.readyPromise;
    }

    getPort(): number {
        if (!this.isReady) {
            console.warn('⚠️ WebSocket server not ready yet, port may be incorrect');
        }
        return this.port;
    }

    setupEventListeners() {
        // Listen for logs
        this.eventBus.on('new_log', (evt) => {
            this.broadcastToAll('LOG', {
                message: evt.message,
                timestamp: evt.ts
            });
        });

        this.eventBus.on('issue', (evt) => {
            this.broadcastToAll('ISSUE', {
                message: evt.message,
                timestamp: evt.ts
            });
        });

        this.eventBus.on('stop', async (evt) => {
            this.broadcastToAll('STOP_WARNING', {
                message: evt.message,
                timestamp: evt.ts
            });
        });

        // Listen for crawl map updates
        this.eventBus.on('crawl_map_updated', (evt) => {
            console.log('🗺️ Crawl map updated:', evt.page.url);
            this.broadcastToAll('CRAWL_MAP_UPDATE', {
                page: evt.page,
                timestamp: evt.ts
            });
        });

        this.eventBus.on('done', (evt) => {
            this.broadcastToAll('DONE', {
                message: evt.message,
                timestamp: evt.ts
            });
        });
    }

    // Send message to specific client - now properly typed
    sendToClient(ws: WebSocket, type: string, data: ConnectionData | FirstConnectionData) {
        if (ws.readyState === WebSocket.OPEN) {
            const message: WebSocketMessage = {
                type: type,
                data: data,
                timestamp: new Date().toISOString()
            };
            ws.send(JSON.stringify(message));
        }
    }

    // Broadcast to all connected clients
    broadcastToAll(type: string, data: WebSocketData) {
        const message: WebSocketMessage = {
            type: type,
            data: data,
            timestamp: new Date().toISOString()
        };

        const messageStr = JSON.stringify(message);
        let sentCount = 0;

        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
                sentCount++;
            } else {
                // Clean up dead connections
                this.clients.delete(client);
            }
        });
    }

    // Method to get connected client count
    getClientCount() {
        return this.clients.size;
    }
}