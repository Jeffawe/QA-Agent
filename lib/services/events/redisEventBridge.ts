import { Redis } from 'ioredis';
import { EventBus } from './event.js';
import { LogManager } from '../../utility/logManager.js';
import { logManagers } from '../memory/logMemory.js';
import { PageMemory } from '../memory/pageMemory.js';
import { ConnectionData, FirstConnectionData, RedisMessage, WebSocketData } from '../../types.js';

export class RedisEventBridge {
    private redisPublisher: Redis;
    private logManager: LogManager | null = null;
    private isReady: boolean = false;
    private readyPromise: Promise<void>;
    private readonly channelName: string = 'websocket_events';
    private currentSessionId: string | null = null; // Track current session
    private isActive: boolean = false; // Track if actively serving a session

    constructor(
        private eventBus: EventBus,
        initialSessionId?: string // Make optional for prewarmed workers
    ) {
        this.eventBus = eventBus;
        this.currentSessionId = initialSessionId || null;

        // Only create log manager if we have a session ID
        if (this.currentSessionId) {
            this.logManager = logManagers.getOrCreateManager(this.currentSessionId);
        }

        const redisConfig = {
            connectTimeout: 2000,
            lazyConnect: false,
            maxRetriesPerRequest: 1,
            retryDelayOnFailover: 50,
            keepAlive: 30000,
            family: 4
        };

        try {
            // Initialize Redis connection (but don't send session-specific messages yet)
            this.redisPublisher = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, redisConfig) : new Redis(redisConfig);
        } catch (error) {
            console.error('❌ Redis connection error:', error);
            throw error;
        }

        // Always initialize Redis connection
        this.readyPromise = this.initializeRedis();
        this.setupEventListeners();
    }

    // Enhanced session update method
    public async activateSession(newSessionId: string): Promise<void> {
        if (this.currentSessionId === newSessionId && this.isActive) {
            return; // Already serving this session
        }

        console.log(`🔄 Activating session ${newSessionId} (previous: ${this.currentSessionId})`);

        // Wait for Redis to be ready first
        await this.waitForReady();

        // Clean up previous session if exists
        if (this.isActive && this.currentSessionId) {
            await this.deactivateCurrentSession();
        }

        // Set new session
        this.currentSessionId = newSessionId;
        this.logManager = logManagers.getOrCreateManager(newSessionId);
        this.isActive = true;

        // Send session-specific initialization messages
        await this.initializeSession();
    }

    // Deactivate current session (for session switching or cleanup)
    public async deactivateCurrentSession(): Promise<void> {
        if (!this.isActive || !this.currentSessionId) {
            return;
        }

        console.log(`🛑 Deactivating session ${this.currentSessionId}`);

        try {
            // Send session end message
            await this.publishMessage('CONNECTION', {
                status: 'session_ended',
                message: 'Session deactivated, worker available for reuse'
            });

            this.isActive = false;
            // Keep currentSessionId for reference but mark as inactive
        } catch (error) {
            console.error('❌ Error deactivating session:', error);
        }
    }

    // Initialize session-specific data
    private async initializeSession(): Promise<void> {
        if (!this.isActive || !this.currentSessionId) {
            return;
        }

        try {
            // Send initial connection message
            await this.publishMessage('CONNECTION', {
                status: 'connected',
                message: 'Worker connected and activated for session'
            });

            // Send initial data for the new session
            await this.publishMessage('INITIAL_DATA', {
                messages: this.logManager?.getLogs(),
                pages: PageMemory.getAllPages(),
                timestamp: Date.now()
            });

            console.log(`✅ Session ${this.currentSessionId} activated and initialized`);
        } catch (error) {
            console.error('❌ Error initializing session:', error);
        }
    }

    // Legacy method for backward compatibility
    public updateSessionId(newSessionId: string) {
        // Delegate to the new activate method
        this.activateSession(newSessionId).catch(error => {
            console.error('❌ Error in updateSessionId:', error);
        });
    }

    private async initializeRedis(): Promise<void> {
        try {
            // Send initial connection message
            await this.redisPublisher.ping();

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

            console.log(`🚀 Redis publisher connected (session: ${this.currentSessionId || 'prewarmed'})`);
            this.isReady = true;

            // Only send session-specific messages if we have an active session
            if (this.isActive && this.currentSessionId) {
                await this.initializeSession();
            }

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

    // async waitForReady(): Promise<void> {
    //     await this.readyPromise;
    // }

    async waitForReady(): Promise<void> {
        const startTime = Date.now();
        const logInterval = setInterval(() => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`Still waiting for Redis to be ready. It is at ${this.redisPublisher.status}. Elapsed (${elapsed}s)`);
        }, 10000); // Log every 2 seconds

        try {
            await this.readyPromise;
            console.log(`Redis ready after ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        } finally {
            clearInterval(logInterval);
        }
    }

    isConnected(): boolean {
        const connected = this.isReady && this.redisPublisher.status === 'ready';
        // Only log if we have an active session to reduce noise
        if (this.isActive) {
            console.log(`Redis connection check: isReady=${this.isReady}, status=${this.redisPublisher.status}, connected=${connected}`);
        }
        return connected;
    }

    setupEventListeners() {
        // Listen for logs (only process if we have an active session)
        this.eventBus.on('new_log', async (evt) => {
            if (this.isActive) {
                await this.publishMessage('LOG', {
                    message: evt.message,
                    timestamp: evt.ts
                });
            }
        });

        this.eventBus.on('issue', async (evt) => {
            if (this.isActive) {
                await this.publishMessage('ISSUE', {
                    message: evt.message,
                    timestamp: evt.ts
                });
            }
        });

        this.eventBus.on('stop', async (evt) => {
            if (this.isActive) {
                await this.publishMessage('STOP_WARNING', {
                    message: evt.message,
                    timestamp: evt.ts
                });
            }
        });

        this.eventBus.on('crawl_map_updated', async (evt) => {
            if (this.isActive) {
                console.log('🗺️ Crawl map updated:', evt.page.url);
                await this.publishMessage('CRAWL_MAP_UPDATE', {
                    page: evt.page,
                    timestamp: evt.ts
                });
            }
        });

        this.eventBus.on('done', async (evt) => {
            if (this.isActive) {
                await this.publishMessage('DONE', {
                    message: evt.message,
                    timestamp: evt.ts
                });
            }
        });
    }

    // Enhanced publish message with session validation
    private async publishMessage(
        type: string,
        data: WebSocketData | ConnectionData | FirstConnectionData
    ): Promise<void> {
        if (!this.isConnected()) {
            if (this.isActive) { // Only warn if we're actively serving a session
                console.warn(`⚠️ Redis not connected. Status: ${this.redisPublisher.status} skipping message:`, type);
            }
            return;
        }

        // Only publish if we have an active session (except for internal connection messages)
        if (!this.isActive && !['CONNECTION'].includes(type)) {
            return;
        }

        const message: RedisMessage = {
            type: type,
            sessionId: this.currentSessionId || 'unknown',
            data: data,
            timestamp: new Date().toISOString()
        };

        try {
            const messageStr = JSON.stringify(message);
            await this.redisPublisher.publish(this.channelName, messageStr);
        } catch (error) {
            console.error('❌ Failed to publish message:', error);
        }
    }

    // Method to send a custom message (for external use)
    async sendMessage(type: string, data: WebSocketData): Promise<void> {
        if (!this.isActive) {
            console.warn('⚠️ No active session, skipping message:', type);
            return;
        }

        if (!this.isConnected()) {
            console.warn('⚠️ Redis not connected, skipping message:', type);
            return;
        }

        await this.publishMessage(type, data);
    }

    public async cleanup(): Promise<void> {
        try {
            console.log(`🧹 Starting cleanup for Redis bridge session ${this.currentSessionId || 'prewarmed'}`);

            // Deactivate current session first
            if (this.isActive) {
                await this.deactivateCurrentSession();
            }

            await this.publishMessage('STOP_WARNING', {
                message: "Worker is shutting down. Stopping session. Click 'Stop Session' if session doesn't end automatically",
                timestamp: Date.now()
            });

            // Remove all event listeners from the event bus
            this.eventBus.removeAllListeners();

            // Remove Redis event listeners
            this.redisPublisher.removeAllListeners('error');
            this.redisPublisher.removeAllListeners('reconnecting');
            this.redisPublisher.removeAllListeners('ready');

            // Mark as not ready
            this.isReady = false;
            this.isActive = false;

            // Send final cleanup message if still connected
            if (this.redisPublisher.status === 'ready') {
                await this.publishMessage('CONNECTION', {
                    status: 'cleaning_up',
                    message: 'Worker cleaning up Redis connection'
                });
            }

            // Wait for pending operations
            await new Promise(resolve => setTimeout(resolve, 100));

            // Disconnect from Redis
            await this.disconnect();

            console.log(`✅ Redis bridge cleanup completed for session ${this.currentSessionId || 'prewarmed'}`);

        } catch (error) {
            console.error(`❌ Error during Redis bridge cleanup:`, error);

            try {
                this.redisPublisher.disconnect();
            } catch (disconnectError) {
                console.error('❌ Force disconnect also failed:', disconnectError);
            }
        }
    }

    async disconnect(): Promise<void> {
        try {
            // Only send disconnect message if we were active
            if (this.isActive && this.currentSessionId) {
                await this.publishMessage('CONNECTION', {
                    status: 'disconnected',
                    message: 'Worker disconnecting from Redis'
                });
            }

            await this.redisPublisher.disconnect();
            console.log(`👋 Redis publisher disconnected for session ${this.currentSessionId || 'prewarmed'}`);
        } catch (error) {
            console.error('❌ Error during Redis disconnect:', error);
        }
    }

    // Utility methods
    getSessionId(): string | null {
        return this.currentSessionId;
    }

    getChannelName(): string {
        return this.channelName;
    }

    isActiveSession(): boolean {
        return this.isActive;
    }

    // Method for prewarmed workers to check if they're ready to accept a session
    isReadyForSession(): boolean {
        return this.isReady && !this.isActive;
    }
}