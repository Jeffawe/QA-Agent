import { EventBus } from './event.js';
import { LogManager } from '../../utility/logManager.js';
import { logManagers } from '../memory/logMemory.js';
import { pageMemory } from '../memory/pageMemory.js';
import { ConnectionData, DisconnectionData, FirstConnectionData, LocalMessage, State, Statistics, WebSocketData } from '../../types.js';
import { parentPort } from "worker_threads";

export class LocalEventBridge {
    private logManager: LogManager | null = null;
    private isReady: boolean = false;
    private readonly channelName: string = 'websocket_message';
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

        this.setupEventListeners();
    }

    // Enhanced session update method
    public async activateSession(newSessionId: string): Promise<void> {
        if (this.currentSessionId === newSessionId && this.isActive) {
            return; // Already serving this session
        }

        console.log(`🔄 Activating session ${newSessionId} (previous: ${this.currentSessionId})`);

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
            await this.publishMessage('DISCONNECTION', {
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
                pages: pageMemory.getAllPages(),
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
                this.logManager?.log(`🗺️ Crawl map updated: ${evt.page.url}`, State.INFO, true);
                await this.publishMessage('CRAWL_MAP_UPDATE', {
                    page: evt.page,
                    timestamp: evt.ts
                });
            }
        });

        this.eventBus.on('done', async (evt) => {
            if (this.isActive) {
                await this.publishMessage('DONE', {
                    statistics: evt.statistics, 
                    message: evt.message,
                    status: 'done',
                    timestamp: evt.ts
                });
            }
        });
    }

    // Enhanced publish message with session validation
    private async publishMessage(                   
        type: string,
        data: WebSocketData | ConnectionData | FirstConnectionData | DisconnectionData
    ): Promise<void> {
        // Only publish if we have an active session (except for internal connection messages)
        if (!this.isActive && !['CONNECTION'].includes(type)) {
            return;
        }

        const message: LocalMessage = {
            type: type,
            sessionId: this.currentSessionId || 'unknown',
            data: data,
            timestamp: new Date().toISOString()
        };

        const channelName = type === 'DISCONNECTION' ? 'disconnect' : this.channelName;

        try {
            if (parentPort) {
                const msg = {
                    type: channelName,
                    sessionId: this.currentSessionId || 'unknown',
                    data: message,
                    timestamp: new Date().toISOString()
                };
                parentPort.postMessage(msg);
            }
        } catch (error) {
            console.error('❌ Failed to publish message:', error);
        }
    }

    // Method to send a custom message (for external use)
    async sendMessage(type: string, data: WebSocketData): Promise<void> {
        if (!this.isActive) {
            return;
        }

        await this.publishMessage(type, data);
    }

    // Cleanup method
    public async cleanup(): Promise<void> {
        try {
            console.log(`🧹 Starting cleanup for Local bridge session ${this.currentSessionId || 'prewarmed'}`);

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

            // Mark as not ready
            this.isReady = false;
            this.isActive = false;

            // Wait for pending operations
            await new Promise(resolve => setTimeout(resolve, 100));

            // Disconnect
            await this.disconnect();

            console.log(`✅ Local bridge cleanup completed for session ${this.currentSessionId || 'prewarmed'}`);

        } catch (error) {
            console.error(`❌ Error during Local bridge cleanup:`, error);
        }
    }

    async disconnect(): Promise<void> {
        try {
            // Only send disconnect message if we were active
            if (this.isActive && this.currentSessionId) {
                await this.publishMessage('DISCONNECTION', {
                    status: 'disconnected',
                    message: 'Worker disconnecting from local bridge',
                });
            }
        } catch (error) {
            console.error('❌ Error during Local bridge disconnect:', error);
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