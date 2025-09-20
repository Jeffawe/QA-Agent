import { Redis } from 'ioredis';
import { EventBus } from './event.js';
import { LogManager } from '../../utility/logManager.js';
import { logManagers } from '../memory/logMemory.js';
import { PageMemory } from '../memory/pageMemory.js';
import { ConnectionData, FirstConnectionData, RedisMessage, WebSocketData } from '../../types.js';

export class RedisEventBridge {
    private redisPublisher: Redis;
    private logManager: LogManager;
    private isReady: boolean = false;
    private readyPromise: Promise<void>;
    private readonly channelName: string = 'websocket_events';

    constructor(
        private eventBus: EventBus,
        private sessionId: string
    ) {
        this.eventBus = eventBus;
        this.logManager = logManagers.getOrCreateManager(sessionId);

        const redisConfig = {
            connectTimeout: 2000,     // Fast connection
            lazyConnect: true,        // Connect only when needed
            maxRetriesPerRequest: 1,  // Fail fast
            enableOfflineQueue: false
        }

        try {
            // Initialize Redis subscriber
            this.redisPublisher = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, redisConfig) : new Redis(redisConfig);
        } catch (error) {
            console.error('❌ Redis connection error:', error);
            throw error;
        }

        // Create a promise that resolves when Redis is ready
        this.readyPromise = this.initializeRedis();

        this.setupEventListeners();
    }

    private async initializeRedis(): Promise<void> {
        try {
            // Wait for Redis to be actually ready
            await new Promise<void>((resolve, reject) => {
                if (this.redisPublisher.status === 'ready') {
                    resolve();
                    return;
                }

                const onReady = () => {
                    this.redisPublisher.off('error', onError);
                    resolve();
                };

                const onError = (error: Error) => {
                    this.redisPublisher.off('ready', onReady);
                    reject(error);
                };

                this.redisPublisher.once('ready', onReady);
                this.redisPublisher.once('error', onError);
            });

            console.log(`🚀 Redis publisher connected for session ${this.sessionId}`);
            this.isReady = true;

            // Send initial connection message
            await this.publishMessage('CONNECTION', {
                status: 'connected',
                message: 'Worker connected to Redis'
            });

            // Send initial data
            await this.publishMessage('INITIAL_DATA', {
                messages: this.logManager.getLogs(),
                pages: PageMemory.getAllPages(),
                timestamp: Date.now()
            });

        } catch (error) {
            console.error('❌ Redis connection error:', error);
            throw error;
        }

        // Handle Redis connection events
        this.redisPublisher.on('error', (error) => {
            console.error('❌ Redis publisher error:', error);
            this.isReady = false;
        });

        this.redisPublisher.on('reconnecting', () => {
            console.log('🔄 Redis publisher reconnecting...');
            this.isReady = false;
        });

        this.redisPublisher.on('ready', () => {
            console.log('✅ Redis publisher ready');
            this.isReady = true;
        });
    }

    // Method to wait for Redis to be ready
    async waitForReady(): Promise<void> {
        await this.readyPromise;
    }

    isConnected(): boolean {
        return this.isReady && this.redisPublisher.status === 'ready';
    }

    setupEventListeners() {
        // Listen for logs
        this.eventBus.on('new_log', async (evt) => {
            await this.publishMessage('LOG', {
                message: evt.message,
                timestamp: evt.ts
            });
        });

        this.eventBus.on('issue', async (evt) => {
            await this.publishMessage('ISSUE', {
                message: evt.message,
                timestamp: evt.ts
            });
        });

        this.eventBus.on('stop', async (evt) => {
            await this.publishMessage('STOP_WARNING', {
                message: evt.message,
                timestamp: evt.ts
            });
        });

        // Listen for crawl map updates
        this.eventBus.on('crawl_map_updated', async (evt) => {
            console.log('🗺️ Crawl map updated:', evt.page.url);
            await this.publishMessage('CRAWL_MAP_UPDATE', {
                page: evt.page,
                timestamp: evt.ts
            });
        });

        this.eventBus.on('done', async (evt) => {
            await this.publishMessage('DONE', {
                message: evt.message,
                timestamp: evt.ts
            });
        });
    }

    // Publish message to Redis channel
    private async publishMessage(
        type: string,
        data: WebSocketData | ConnectionData | FirstConnectionData
    ): Promise<void> {
        if (!this.isConnected()) {
            console.warn('⚠️ Redis not connected, skipping message:', type);
            return;
        }

        const message: RedisMessage = {
            type: type,
            sessionId: this.sessionId,
            data: data,
            timestamp: new Date().toISOString()
        };

        try {
            const messageStr = JSON.stringify(message);
            const subscriberCount = await this.redisPublisher.publish(this.channelName, messageStr);
        } catch (error) {
            console.error('❌ Failed to publish message:', error);
        }
    }

    // Method to send a custom message (for external use)
    async sendMessage(type: string, data: WebSocketData): Promise<void> {
        await this.publishMessage(type, data);
    }

    // Graceful shutdown
    async disconnect(): Promise<void> {
        try {
            // Send disconnect message
            await this.publishMessage('CONNECTION', {
                status: 'disconnected',
                message: 'Worker disconnecting from Redis'
            });

            await this.redisPublisher.disconnect();
            console.log(`👋 Redis publisher disconnected for session ${this.sessionId}`);
        } catch (error) {
            console.error('❌ Error during Redis disconnect:', error);
        }
    }

    // Get session ID (useful for debugging)
    getSessionId(): string {
        return this.sessionId;
    }

    // Get channel name (useful for parent server setup)
    getChannelName(): string {
        return this.channelName;
    }
}