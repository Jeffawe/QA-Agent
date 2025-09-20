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
import { PageMemory } from './services/memory/pageMemory.js';
import { dataMemory } from './services/memory/dataMemory.js';
import { RedisEventBridge } from './services/events/redisEventBridge.js';
import { CrawlMap } from './utility/crawlMap.js';

let agent: BossAgent | null = null;
let isInitialized = false;
let redisBridge: RedisEventBridge | null = null;
let eventBus: any = null;

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

        parentPort?.postMessage({
            type: 'initialized',
            websocketPort: websocketPort
        });

        console.log(`✅ Worker initialized for session ${sessionId} with WebSocket port ${websocketPort}`);

    } catch (error) {
        console.error('❌ Worker initialization error:', error);
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
        });

        process.exit(1);
    }
};

// Streamlined validator creation with lazy loading
const createValidatorsAsync = async (sessionId: string): Promise<number> => {
    try {
        console.log(`🔨 Creating validators for session ${sessionId}...`);

        // Reuse existing event bus if available (for pre-warmed workers)
        if (!eventBus) {
            eventBus = eventBusManager.getOrCreateBus(sessionId);
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

        // Reuse Redis bridge if available
        if (!redisBridge) {
            console.log(`🌐 Setting up Redis event bridge...`);
            redisBridge = new RedisEventBridge(eventBus, sessionId);
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
const handleSessionDataUpdate = (sessionId: string, url: any, data: any) => {
    console.log(`🔄 Updating session data for pre-warmed worker: ${sessionId}`);

    // Update worker data
    (workerData as any).sessionId = sessionId;
    (workerData as any).url = url;
    (workerData as any).data = data;
    (workerData as any).preWarmed = false; // No longer pre-warmed

    // Update Redis bridge for new session
    if (redisBridge) {
        redisBridge = new RedisEventBridge(eventBus, sessionId);
    }

    console.log(`✅ Session data updated for pre-warmed worker: ${sessionId}`);
};

if (parentPort) {
    parentPort.on('message', async (data) => {
        if (data.command === 'update_session_data') {
            // Handle session data update for pre-warmed workers
            handleSessionDataUpdate(data.sessionId, data.url, data.data);
            return;
        }

        if (data.command === 'start') {
            try {
                // Skip initialization for pre-warmed workers that are already initialized
                if (!isInitialized) {
                    await initializeWorker();
                }

                if (agent) {
                    console.warn(`Agent already running for session ${workerData.sessionId}`);
                    return;
                }

                const workerEventBus = eventBusManager.getOrCreateBus(data.agentConfig.sessionId);

                // Load data memory only when needed
                if (workerData.data && typeof workerData.data === 'object') {
                    dataMemory.loadData(workerData.data);
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

                        parentPort?.postMessage({
                            type: 'session_cleanup',
                            sessionId: sessionId,
                            error: error instanceof Error ? error.message : String(error)
                        });
                    } finally {
                        workerEventBus.off('stop', stopHandler);
                        console.log(`✅ Agent stopped, terminating worker...`);
                        process.exit(0);
                    }
                };

                workerEventBus.on('stop', stopHandler);

                // Parallel agent config processing
                const fullAgentConfigs: Set<AgentConfig> = new Set(
                    data.agentConfig.agentConfigs.map((config: MiniAgentConfig) => ({
                        ...config,
                        agentClass: AgentFactory.getAgentClass(config.name)
                    }))
                );

                // Store API key in parallel with agent creation
                const apiKeyPromise = Promise.resolve(
                    storeSessionApiKey(data.agentConfig.sessionId, data.agentConfig.apiKey)
                );

                const agentCreationPromise = new Promise<BossAgent>((resolve) => {
                    const newAgent = new BossAgent({
                        sessionId: data.agentConfig.sessionId,
                        eventBus: workerEventBus,
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

                agent = newAgent;

                // Start agent with minimal delay
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

    const stopWorker = async () => {
        try {
            await cleanup();

            parentPort?.postMessage({
                type: 'session_cleanup',
                sessionId: workerData.sessionId,
                message: 'Worker completed cleanup, requesting parent cleanup'
            });

            // OPTIMIZATION 15: Reduced cleanup delay
            await new Promise(resolve => setTimeout(resolve, 50));
            console.log(`✅ Agent stopped, terminating worker...`);
        } catch (error) {
            console.error('Error during cleanup:', error);

            parentPort?.postMessage({
                type: 'session_cleanup',
                sessionId: workerData.sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
        } finally {
            console.log(`✅ Agent stopped, terminating worker...`);
            process.exit(0);
        }
    };
}

// Streamlined cleanup with parallel operations
const cleanup = async () => {
    console.log(`🛑 Stopping agent ${workerData.sessionId}...`);
    CrawlMap.finish();

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
            PageMemory.clear();
        }),
        Promise.resolve().then(() => {
            dataMemory.clear();
        }),
        Promise.resolve().then(() => {
            redisBridge?.cleanup();
        }),
    );

    // Execute all cleanup operations in parallel
    await Promise.all(cleanupPromises);
    console.log(`✅ Cleanup completed for ${workerData.sessionId}`);
};