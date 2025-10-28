import WebSocket, { WebSocketServer } from 'ws';
import { deleteSession, getSession } from '../memory/sessionMemory.js';
import { LocalMessage } from '../../types.js';
import { sendDiscordError } from '../../utility/error.js';

interface ClientConnection {
    ws: WebSocket;
    sessionId: string;
    connectedAt: Date;
}

export class ParentWebSocketServer {
    private clients: Map<string, ClientConnection> = new Map();
    private wss: WebSocketServer;
    private port: number;
    private readyPromise: Promise<void>;
    private isReady: boolean = false;
    private readonly channelName: string = 'websocket_events';

    constructor(
        server: any,
        port: number
    ) {
        this.port = port;
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

            if (this.clients.has(sessionId)) {
                console.warn('⚠️ Client connected with duplicate sessionId, closing connection');
                ws.close(1008, 'Duplicate session ID');
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
                    message: `Connected to session ${sessionId}`
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
                        if (session.worker) {
                            session.worker.removeAllListeners('message');
                            session.worker.removeAllListeners('error');
                            session.worker.removeAllListeners('exit');
                            console.log(`⏰ Force terminating stuck worker ${sessionId}`);
                            session.worker?.terminate();
                        }
                        deleteSession(sessionId);
                    }, 10000);
                }
                this.clients.delete(sessionId);
            });

            ws.on('error', (error: Error) => {
                console.error(`❌ WebSocket error for session ${sessionId}:`, error);
                sendDiscordError(error, { sessionId, context: 'ParentWebSocketServer WebSocket error' });
                this.clients.delete(sessionId);
            });
        });

        // Handle WebSocket server errors
        this.wss.on('error', (error: Error) => {
            console.error('❌ WebSocket server error:', error);
        });
    }

    /**
     * Sends a message to the client with the given session id.
     * If the client does not exist or the connection is closed, the method will clean up the dead connection.
     * @param sessionId - The id of the session to send the message to.
     * @param message - The message to send to the client.
    */
    public sendToClient(sessionId: string, message: LocalMessage) {
        const client = this.clients.get(sessionId);

        if (!client) {
            return;
        }

        if (client.ws.readyState === WebSocket.OPEN) {
            try {
                const payload = JSON.stringify(message);
                client.ws.send(payload);
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

    /**
     * Closes the client connection for the given session id.
     * If the connection is still open, it will be closed with a code of 1000 and a reason of 'Session ended'.
     * The client will then be removed from the list of active clients.
     * @param sessionId - The id of the session to close the connection for.
     * @returns A promise that resolves when the connection has been closed.
     */
    async closeClientConnection(sessionId: string): Promise<void> {
        const client = this.clients.get(sessionId);
        if (client) {
            try {
                if (client.ws.readyState === WebSocket.OPEN) {
                    setTimeout(() => {
                        client.ws.close(1000, 'Session ended');
                        this.clients.delete(sessionId);
                        console.log(`✅ Closed client connection for session: ${sessionId}`);
                    }, 100);
                } else {
                    // If not open, delete immediately
                    this.clients.delete(sessionId);
                    console.log(`✅ Client connection already closed for session: ${sessionId}`);
                }
            } catch (error) {
                console.error(`❌ Error closing client connection for session ${sessionId}:`, error);
                this.clients.delete(sessionId); // Clean up on error
            }
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
    broadcast(message: Omit<LocalMessage, 'sessionId'>) {
        this.clients.forEach((client, sessionId) => {
            this.sendToClient(sessionId, { ...message, sessionId });
        });
    }

    // Send message to specific session
    sendToSession(sessionId: string, message: Omit<LocalMessage, 'sessionId'>) {
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

            console.log('✅ Parent WebSocket server shutdown complete');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }
}