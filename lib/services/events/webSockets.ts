import WebSocket, { WebSocketServer } from 'ws';
import { EventBus } from './event.js';
import { PageDetails } from '../../types.js';

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

// Add interface for the complete message structure
interface WebSocketMessage {
  type: string;
  data: WebSocketData | ConnectionData;
  timestamp: string;
}

export class WebSocketEventBridge {
    private clients: Set<WebSocket>;
    private wss: WebSocketServer;

    constructor(private eventBus: EventBus, port = 3000) {
        this.eventBus = eventBus;
        this.clients = new Set();

        // Create WebSocket server
        this.wss = new WebSocketServer({ port });
        console.log(`🚀 WebSocket server started on port ${port}`);

        // Handle new client connections
        this.wss.on('connection', (ws) => {
            console.log('📞 New frontend client connected');
            this.clients.add(ws);

            // Send welcome message
            this.sendToClient(ws, 'CONNECTION', {
                status: 'connected',
                message: 'WebSocket connected successfully'
            });

            // Handle client disconnect
            ws.on('close', () => {
                console.log('🔌 Client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.clients.delete(ws);
            });
        });

        // Set up event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Listen for logs
        this.eventBus.on('new_log', (evt) => {
            console.log('📝 Log event received:', evt.message);
            this.broadcastToAll('LOG', {
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
    }

    // Send message to specific client - now properly typed
    sendToClient(ws: WebSocket, type: string, data: ConnectionData) {
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

        if (sentCount > 0) {
            console.log(`📤 Broadcasted ${type} to ${sentCount} client(s)`);
        }
    }

    // Method to get connected client count
    getClientCount() {
        return this.clients.size;
    }
}