import WebSocket, { WebSocketServer } from 'ws';
import { Redis } from 'ioredis';
import { deleteSession, getSession } from '../memory/sessionMemory.js';

interface RedisMessage {
    type: string;
    sessionId: string;
    data: any;
    timestamp: string;
}

interface ClientConnection {
    ws: WebSocket;
    sessionId: string;
    connectedAt: Date;
}

export class ParentWebSocketServer {
    private clients: Map<string, ClientConnection> = new Map();
    private wss: WebSocketServer;
    private redisSubscriber: Redis;
    private port: number;
    private readyPromise: Promise<void>;
    private isReady: boolean = false;
    private readonly channelName: string = 'websocket_events';

    constructor(
        server: any,
        port: number,
        redisConfig?: {
            host?: string;
            port?: number;
            password?: string;
            db?: number;
        }
    ) {
        this.port = port;
        try {
            // Initialize Redis subscriber
            this.redisSubscriber = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : new Redis();
        } catch (error) {
            console.error('❌ Redis connection error:', error);
            throw error;
        }

        // Create WebSocket server
        this.wss = new WebSocketServer({
            server, // Use the same server
            path: '/websocket' // Optional: specify a path
        });

        // Create a promise that resolves when both Redis and WebSocket are ready
        this.readyPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            // Initialize Redis subscriber
            await this.redisSubscriber.subscribe(this.channelName);
            console.log(`🔔 Redis subscriber connected and subscribed to ${this.channelName}`);

            // Set up Redis message handling
            this.redisSubscriber.on('message', (channel: string, message: string) => {
                if (channel === this.channelName) {
                    this.handleRedisMessage(message);
                }
            });

            // Handle Redis connection events
            this.redisSubscriber.on('error', (error: Error) => {
                console.error('❌ Redis subscriber error:', error);
            });

            this.redisSubscriber.on('reconnecting', () => {
                console.log('🔄 Redis subscriber reconnecting...');
            });

            // Set up WebSocket server - when using existing server, it's ready immediately
            console.log(`🚀 Parent WebSocket server attached to existing server on port ${this.port}`);

            this.setupWebSocketHandlers();
            this.isReady = true;

        } catch (error) {
            console.error('❌ Failed to initialize parent server:', error);
            throw error;
        }
    }

    private setupWebSocketHandlers() {
        this.wss.on('connection', (ws: WebSocket, request) => {
            // Extract sessionId from query parameters or headers
            const baseUrl = request.headers.host || 'localhost';
            const url = new URL(request.url || '', `http://${baseUrl}`);
            const sessionId = url.searchParams.get('sessionId') ||
                request.headers['x-session-id'] as string;

            if (!sessionId) {
                console.warn('⚠️ Client connected without sessionId, closing connection');
                ws.close(1008, 'Session ID required');
                return;
            }

            console.log(`📞 New client connected for session: ${sessionId}`);

            // Store client connection with sessionId
            const clientConnection: ClientConnection = {
                ws,
                sessionId,
                connectedAt: new Date()
            };

            this.clients.set(sessionId, clientConnection);

            // Send welcome message
            this.sendToClient(sessionId, {
                type: 'CONNECTION_ACK',
                data: {
                    status: 'connected',
                    message: `Connected to session ${sessionId}`,
                    sessionId
                },
                timestamp: new Date().toISOString(),
                sessionId
            });

            // Handle client messages (if needed)
            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    console.log(`📨 Message from client ${sessionId}:`, message.type);
                    // Handle client-to-server messages here if needed
                } catch (error) {
                    console.error('❌ Invalid message from client:', error);
                }
            });

            // Handle client disconnect
            ws.on('close', () => {
                console.log(`🔌 Client disconnected from session: ${sessionId}`);
                const session = getSession(sessionId);

                if (!session) {
                    console.log(`❌ Session ${sessionId} not found.`);
                    return;
                }

                if (session.worker) {
                    session.worker.postMessage({ command: 'stop' });

                    setTimeout(() => {
                        console.log(`⏰ Force terminating stuck worker ${sessionId}`);
                        session.worker?.terminate();
                        deleteSession(sessionId);
                    }, 10000);
                }
                this.clients.delete(sessionId);
            });

            ws.on('error', (error: Error) => {
                console.error(`❌ WebSocket error for session ${sessionId}:`, error);
                this.clients.delete(sessionId);
            });
        });

        // Handle WebSocket server errors
        this.wss.on('error', (error: Error) => {
            console.error('❌ WebSocket server error:', error);
        });
    }

    private handleRedisMessage(messageStr: string) {
        try {
            const message: RedisMessage = JSON.parse(messageStr);
            const { sessionId } = message;

            // Route message to the appropriate client
            this.sendToClient(sessionId, message);

        } catch (error) {
            console.error('❌ Failed to parse Redis message:', error);
        }
    }

    private sendToClient(sessionId: string, message: RedisMessage) {
        const client = this.clients.get(sessionId);

        if (!client) {
            return;
        }

        if (client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`❌ Failed to send message to client ${sessionId}:`, error);
                // Clean up dead connection
                this.clients.delete(sessionId);
            }
        } else {
            // Clean up dead connection
            console.log(`🧹 Cleaning up dead connection for session: ${sessionId}`);
            this.clients.delete(sessionId);
        }
    }

    // Method to wait for the server to be ready
    async waitForReady(): Promise<void> {
        console.log('🚀 Waiting for parent WebSocket server to be ready...');
        await this.readyPromise;
    }

    getPort(): number {
        if (!this.isReady) {
            console.warn('⚠️ Server not ready yet, port may be incorrect');
        }
        return this.port;
    }

    // Get statistics
    getStats() {
        return {
            connectedClients: this.clients.size,
            clientSessions: Array.from(this.clients.keys()),
            isReady: this.isReady,
            port: this.port
        };
    }

    // Send a message to all clients (broadcast)
    broadcast(message: Omit<RedisMessage, 'sessionId'>) {
        this.clients.forEach((client, sessionId) => {
            this.sendToClient(sessionId, { ...message, sessionId });
        });
    }

    // Send message to specific session
    sendToSession(sessionId: string, message: Omit<RedisMessage, 'sessionId'>) {
        this.sendToClient(sessionId, { ...message, sessionId });
    }

    // Graceful shutdown
    async shutdown(): Promise<void> {
        console.log('🛑 Shutting down parent WebSocket server...');

        try {
            // Close all client connections
            this.clients.forEach((client, sessionId) => {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.close(1000, 'Server shutting down');
                }
            });
            this.clients.clear();

            // Close WebSocket server
            this.wss.close();

            // Disconnect from Redis
            this.redisSubscriber.disconnect();

            console.log('✅ Parent WebSocket server shutdown complete');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }
}