import { parentPort, workerData } from 'worker_threads';
import BossAgent from './agent.js';
import { eventBusManager } from './services/events/eventBus.js';
import { AgentFactory } from './agentFactory.js';
import { AgentConfig, MiniAgentConfig, State } from './types.js';
import { storeSessionApiKey } from './services/memory/apiMemory.js';
import { ActionSpamValidator } from './services/validators/actionValidator.js';
import { ErrorValidator } from './services/validators/errorValidator.js';
import { LLMUsageValidator } from './services/validators/llmValidator.js';
import { logManagers } from './services/memory/logMemory.js';
import { ThinkerValidator } from './services/validators/thinkerValidator.js';
import { NewPageValidator } from './services/validators/newPageValidator.js';
import { ValidatorWarningValidator } from './services/validators/validatorWarningValidator.js';
import { pageMemory } from './services/memory/pageMemory.js';
import { dataMemory } from './services/memory/dataMemory.js';
import { LocalEventBridge } from './services/events/localEventBridge.js';
import { crawlMap } from './utility/crawlMap.js';
import { extractErrorMessage } from './utility/functions.js';

let agent: BossAgent | null = null;
let isInitialized = false;
let localBridge: LocalEventBridge | null = null;
let eventBus: any = null;
const workerId = Math.random().toString(36).substring(7); // Unique worker ID
let isActive = false;
let currentSessionId: string | null = null;
let isShuttingDown = false;
let cleanupTimeout: NodeJS.Timeout | null = null;
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

const checkHealth = () => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

    console.log(`📊 [Worker ${workerId}] Health check:`, {
        heapUsed: `${heapUsedMB}MB`,
        isActive: isActive,
        sessionId: currentSessionId,
        hasAgent: !!agent
    });

    // Force cleanup if memory usage is too high
    if (heapUsedMB > 1000) { // 1GB threshold
        console.warn(`⚠️ [Worker ${workerId}] High memory usage, forcing cleanup`);
        forceShutdown();
    }
}

const forceShutdown = async () => {
    if (isShuttingDown) return;

    console.log(`🛑 [Worker ${workerId}] Force shutdown initiated`);
    isShuttingDown = true;

    if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
        cleanupTimeout = null;
    }

    try {
        await cleanup();
    } catch (error) {
        console.error(`❌ [Worker ${workerId}] Force shutdown error:`, error);
    } finally {
        process.exit(0);
    }
}

const emergencyShutdown = () => {
    console.log(`🚨 [Worker ${workerId}] Emergency shutdown`);
    isShuttingDown = true;

    if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
        cleanupTimeout = null;
    }

    // Skip cleanup and exit immediately
    process.exit(1);
}

const setupProcessHandlers = () => {
    // Graceful shutdown handlers
    process.on('SIGTERM', forceShutdown.bind(this));
    process.on('SIGINT', forceShutdown.bind(this));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        console.error(`💥 [Worker ${workerId}] Uncaught Exception:`, error);
        emergencyShutdown();
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
        console.error(`💥 [Worker ${workerId}] Unhandled Rejection:`, reason);
        emergencyShutdown();
    });

    // Prevent the worker from hanging
    cleanupTimeout = setTimeout(() => {
        if (!isShuttingDown) {
            checkHealth();
        }
    }, HEALTH_CHECK_INTERVAL); // 5 minutes
}

// Handle pre-warmed worker initialization
if (workerData?.preWarmed) {
    console.log(`🔥 Initializing pre-warmed worker ${workerId}...`);

    // Initialize infrastructure without session
    if (!eventBus) eventBus = eventBusManager.getOrCreateBus();
    if (!localBridge) {
        localBridge = new LocalEventBridge(eventBus);
    }

    setupProcessHandlers();

    console.log(`♨️ Pre-warmed worker ${workerId} initialized, waiting for session and local Bridge...`);
}

// Pre-initialize common resources for pre-warmed workers
const initializeWorker = async () => {
    try {
        const { sessionId } = workerData;

        // Early return if already initialized (for pre-warmed workers)
        if (isInitialized && workerData.preWarmed) {
            console.log('✅ Using pre-warmed worker, skipping full initialization');
            return;
        }

        // Parallel validator creation and event bus setup
        const websocketPort = await createValidatorsAsync(sessionId);

        const logManager = logManagers.getOrCreateManager(sessionId);
        logManager.log(`Worker initialized for session ${sessionId} with WebSocket port ${websocketPort}`, State.INFO, false);

        isInitialized = true;

        currentSessionId = sessionId;
        isActive = true;

        parentPort?.postMessage({
            type: 'initialized',
            websocketPort: websocketPort
        });

        console.log(`✅ Worker initialized for session ${sessionId} with port ${websocketPort}`);

    } catch (error) {
        console.error('❌ Worker initialization error:', error);
        const errorMessage = extractErrorMessage(error);
        parentPort?.postMessage({
            type: 'error',
            error: errorMessage
        });

        process.exit(1);
    }
};


/**
 * Creates all validators for a given session ID in parallel batches.
 * @param {string} sessionId - The unique identifier for the session.
 * @returns {Promise<number>} A promise that resolves with the port number used by the event bridge.
 * @description
 * This function creates an event bus and all the validators for a session in parallel.
 * It then sets up the Local event bridge and activates the session.
 * Finally, it returns the port number used by the event bridge.
 */
const createValidatorsAsync = async (sessionId: string): Promise<number> => {
    try {
        console.log(`🔨 Creating validators for session ${sessionId}...`);

        // Reuse existing event bus if available (for pre-warmed workers)
        if (!eventBus) {
            eventBus = eventBusManager.getOrCreateBus();
        }

        // Create validators in parallel batches
        const validatorPromises = [
            () => new ActionSpamValidator(eventBus, sessionId),
            () => new ErrorValidator(eventBus, sessionId),
            () => new LLMUsageValidator(eventBus, sessionId),
            () => new ThinkerValidator(eventBus, sessionId),
            () => new NewPageValidator(eventBus, sessionId),
            () => new ValidatorWarningValidator(eventBus, sessionId)
        ];

        // Execute validator creation in parallel
        await Promise.all(validatorPromises.map(createValidator =>
            createValidator()
        ));

        console.log(`📋 All validators created successfully`);

        // Reuse Local bridge if available
        if (!localBridge) {
            console.log(`🌐 Setting up Local event bridge...`);
            localBridge = new LocalEventBridge(eventBus, sessionId);
            await localBridge.activateSession(sessionId);

            console.log(`✅ Local event bridge connected`);
        }

        const port = parseInt(process.env.PORT ?? '3001');
        console.log(`✅ Event bridge ready on port ${port}`);
        return port;

    } catch (error) {
        console.error('❌ Error in createValidatorsAsync:', error);
        throw error;
    }
};

// Handle session data updates for pre-warmed workers
const activateSession = async (sessionId: string, url: any, data: any) => {
    try {
        console.log(`🚀 Activating session ${sessionId} on worker ${workerId}`);

        if (!localBridge) {
            throw new Error('Local bridge not initialized');
        }

        // Update worker data
        (workerData as any).sessionId = sessionId;
        (workerData as any).url = url;
        (workerData as any).data = data;
        (workerData as any).preWarmed = false;

        console.log(`✅ Session ${sessionId} activated on worker ${workerId}`);

    } catch (error) {
        console.error(`❌ Error activating session ${sessionId}:`, error);
        const errorMessage = extractErrorMessage(error);
        parentPort?.postMessage({
            type: 'error',
            sessionId,
            error: errorMessage
        });
    }
};

if (parentPort) {
    parentPort.on('message', async (data) => {
        if (data.command === 'activate_session') {
            await activateSession(data.sessionId, data.url, data.data);
            return;
        }

        if (data.command === 'start') {
            try {
                console.log(`STEP 6: Starting agent for session ${workerData.sessionId} on worker ${workerId}...`);

                // Skip initialization for pre-warmed workers that are already initialized
                if (!isInitialized) {
                    await initializeWorker();
                }

                console.log(`STEP 7: Worker ${workerId} initialized, proceeding to start agent for session ${workerData.sessionId}...`);

                if (agent) {
                    console.warn(`Agent already running for session ${workerData.sessionId}`);
                    return;
                }

                if (!eventBus) {
                    eventBus = eventBusManager.getOrCreateBus();
                }

                const apikey = data.agentConfig.apiKey ?? process.env.API_KEY ?? '';

                // Load data memory only when needed
                if (workerData.data && typeof workerData.data === 'object') {
                    dataMemory.loadData(workerData.data);
                    console.log('Data loaded into memory', dataMemory.getAllData());

                    if (apikey && apikey !== '' && dataMemory.getData('endpoint') === true) {
                        dataMemory.setData('advanced_endpoint', true);
                    }
                }

                const stopHandler = async (evt: any) => {
                    const sessionId = evt.sessionId;
                    console.log(`🔄 Attempting to stop session: ${sessionId} because of ${evt.message}`);

                    try {
                        await cleanup();
                        console.log(`✅ Agent stopped, cleaning up...`);

                        parentPort?.postMessage({
                            type: 'session_cleanup',
                            sessionId: sessionId,
                            message: 'Worker completed cleanup, requesting parent cleanup'
                        });

                        // OPTIMIZATION 11: Reduced delay for faster cleanup
                        await new Promise(resolve => setTimeout(resolve, 50));

                    } catch (error) {
                        console.error('Error during cleanup:', error);
                        const errorMessage = extractErrorMessage(error);

                        parentPort?.postMessage({
                            type: 'session_cleanup',
                            sessionId: sessionId,
                            error: errorMessage
                        });
                    } finally {
                        eventBus.off('stop', stopHandler);
                        console.log(`✅ Agent stopped, terminating worker...`);
                        process.exit(0);
                    }
                };

                eventBus.on('stop', stopHandler);

                // Parallel agent config processing
                const fullAgentConfigs: Set<AgentConfig> = new Set(
                    data.agentConfig.agentConfigs.map((config: MiniAgentConfig) => ({
                        ...config,
                        agentClass: AgentFactory.getAgentClass(config.name)
                    }))
                );

                console.log(`STEP 8: Full agent configs prepared:`);

                // Store API key in parallel with agent creation
                const apiKeyPromise = Promise.resolve(
                    storeSessionApiKey(data.agentConfig.sessionId, apikey)
                );

                const agentCreationPromise = new Promise<BossAgent>((resolve) => {
                    const newAgent = new BossAgent({
                        sessionId: data.agentConfig.sessionId,
                        eventBus: eventBus,
                        goalValue: data.agentConfig.goalValue,
                        agentConfigs: fullAgentConfigs,
                    });
                    resolve(newAgent);
                });

                // Execute both operations in parallel
                const [newAgent] = await Promise.all([
                    agentCreationPromise,
                    apiKeyPromise
                ]);

                console.log(`STEP 9: Agent creation promise created for session ${data.agentConfig.sessionId}`);

                agent = newAgent;

                // Start agent with minimal delay
                console.log(`🚀 Starting agent for session ${data.agentConfig.sessionId}...`);
                await agent.start(workerData.url);

                console.log(`✅ Agent completed for session ${data.agentConfig.sessionId}`);
                await stopWorker();

            } catch (error) {
                console.error('❌ Worker agent error:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                parentPort?.postMessage({
                    type: 'error',
                    error: errorMessage
                });
                await stopWorker();
            }
        }

        if (data.command === 'stop') {
            await stopWorker();
        }
    });

    /**
     * Stops the worker and performs cleanup operations.
     * Notifies the parent of the completion and any errors that occurred.
     * Exits the worker process after cleanup.
     */
    const stopWorker = async () => {
        try {
            await cleanup();

            parentPort?.postMessage({
                type: 'session_cleanup',
                sessionId: workerData.sessionId,
                message: 'Worker completed cleanup',
                workerId: workerId
            });

        } catch (error) {
            console.error(`❌ [Worker ${workerId}] Stop worker error:`, error);
            const errorMessage = extractErrorMessage(error);

            parentPort?.postMessage({
                type: 'session_cleanup',
                sessionId: workerData.sessionId,
                error: errorMessage,
                workerId: workerId
            });
        } finally {
            process.exit(0);
        }
    };
}

// Streamlined cleanup with parallel operations
const cleanup = async () => {
    if (isShuttingDown) {
        console.log(`⚠️ [Worker ${workerId}] Cleanup already in progress`);
        return;
    }

    try {
        console.log(`🛑 Stopping agent ${workerData.sessionId}...`);
        crawlMap.finish();

        const cleanupPromises: Promise<void>[] = [];

        if (agent) {
            cleanupPromises.push(agent.stop().then(() => {
                agent = null;
            }));
        }

        // Parallel cleanup of memory systems
        cleanupPromises.push(
            Promise.resolve().then(() => {
                eventBusManager.clear();
            }),
            Promise.resolve().then(() => {
                logManagers.clear();
            }),
            Promise.resolve().then(() => {
                pageMemory.clear();
            }),
            Promise.resolve().then(() => {
                dataMemory.clear();
            }),
            Promise.resolve().then(() => {
                localBridge?.cleanup();
            }),
        );

        // Execute all cleanup operations in parallel
        await Promise.all(cleanupPromises);
        console.log(`✅ Cleanup completed for ${workerData.sessionId}`);
    } catch (error) {
        console.error(`❌ Cleanup error for ${workerData.sessionId}:`, error);
        throw error;
    } finally {
        isActive = false;
        currentSessionId = null;
        isShuttingDown = false;
        agent = null;

        if (cleanupTimeout) {
            clearTimeout(cleanupTimeout);
            cleanupTimeout = null;
        }
    }
};