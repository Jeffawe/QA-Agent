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

const initializeWorker = async () => {
    try {
        const { sessionId } = workerData;

        // Create validators in the worker
        const websocketPort = await createValidatorsAsync(sessionId);

        console.log('✅ createValidatorsAsync completed, port:', websocketPort);
        const logManager = logManagers.getOrCreateManager(sessionId);
        console.log('✅ logManager created');
        logManager.log(`Worker initialized for session ${sessionId} with WebSocket port ${websocketPort}`, State.INFO, false);
        console.log('✅ log written');
        console.log('About to postMessage with:', { websocketPort, sessionId });

        isInitialized = true

        parentPort?.postMessage({
            type: 'initialized',
            websocketPort: websocketPort
        });

        console.log(`✅ Worker initialized for session ${sessionId} with WebSocket port ${websocketPort}`);
        logManager.log(`Worker initialized for session ${sessionId} with WebSocket port ${websocketPort}`, State.INFO, false);

    } catch (error) {
        console.error('❌ Worker initialization error:', error);
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
        });

        process.exit(1);
    }
};

const createValidatorsAsync = async (sessionId: string): Promise<number> => {
    try {
        console.log(`🔨 Creating validators for session ${sessionId}...`);

        const eventBus = eventBusManager.getOrCreateBus(sessionId);

        // Create validators
        console.log(`📋 Creating action validators...`);
        new ActionSpamValidator(eventBus, sessionId);
        new ErrorValidator(eventBus, sessionId);
        new LLMUsageValidator(eventBus, sessionId);
        new ThinkerValidator(eventBus, sessionId);
        new NewPageValidator(eventBus, sessionId);
        new ValidatorWarningValidator(eventBus, sessionId);

        console.log(`🌐 Setting up WebSocket server...`);
        // Create WebSocket bridge
        // const webSocketEventBridge = new WebSocketEventBridge(eventBus, sessionId, WebSocket_PORT);

        const redisBridge = new RedisEventBridge(eventBus, sessionId);

        // WAIT for the WebSocket server to be ready
        await redisBridge.waitForReady();

        // Now get the actual port
        const port = parseInt(process.env.PORT ?? '3001');

        console.log(`✅ WebSocket server ready on port ${port}`);
        return port;

    } catch (error) {
        console.error('❌ Error in createValidatorsAsync:', error);
        throw error;
    }
};

if (parentPort) {
    parentPort.on('message', async (data) => {
        if (data.command === 'start') {
            try {
                if (!isInitialized) {
                    await initializeWorker();
                }

                if (agent) {
                    console.warn(`Agent already running for session ${workerData.sessionId}`);
                    return;
                }

                const workerEventBus = eventBusManager.getOrCreateBus(data.agentConfig.sessionId);
                if (workerData.data && typeof workerData.data === 'object') {
                    dataMemory.loadData(workerData.data);
                }

                const stopHandler = async (evt: any) => {
                    const sessionId = evt.sessionId;
                    console.log(`🔄 Attempting to stop session: ${sessionId} because of ${evt.message}`);

                    try {
                        await cleanup();
                        console.log(`✅ Agent stopped, cleaning up...`);

                        // Notify parent thread to cleanup session values
                        parentPort?.postMessage({
                            type: 'session_cleanup',
                            sessionId: sessionId,
                            message: 'Worker completed cleanup, requesting parent cleanup'
                        });

                        // Small delay to ensure message is sent before exit
                        await new Promise(resolve => setTimeout(resolve, 100));

                    } catch (error) {
                        console.error('Error during cleanup:', error);

                        // Even if cleanup fails, notify parent
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
                //workerEventBus.on('done', stopHandler);

                // Convert serializable configs back to full AgentConfigs
                const fullAgentConfigs: Set<AgentConfig> = new Set(
                    data.agentConfig.agentConfigs.map((config: MiniAgentConfig) => ({
                        ...config,
                        agentClass: AgentFactory.getAgentClass(config.name) // Recreate class reference
                    }))
                );

                storeSessionApiKey(data.agentConfig.sessionId, data.agentConfig.apiKey);

                agent = new BossAgent({
                    sessionId: data.agentConfig.sessionId,
                    eventBus: workerEventBus,
                    goalValue: data.agentConfig.goalValue,
                    agentConfigs: fullAgentConfigs,
                });

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

            await new Promise(resolve => setTimeout(resolve, 100));
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

const cleanup = async () => {
    console.log(`🛑 Stopping agent ${workerData.sessionId}...`);

    if (agent) {
        await agent.stop();
        agent = null; // Clear the reference
    }

    eventBusManager.clear();
    logManagers.clear();
    CrawlMap.finish();
    PageMemory.clear();
    dataMemory.clear();
};


console.log(`✅ Worker ready for session ${workerData.sessionId}`);