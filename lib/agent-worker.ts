import { parentPort, workerData } from 'worker_threads';
import BossAgent from './agent.js';
import { eventBusManager } from './services/events/eventBus.js';
import { deleteSession } from './services/memory/sessionMemory.js';
import { AgentFactory } from './agentFactory.js';
import { AgentConfig, MiniAgentConfig } from './types.js';
import { storeSessionApiKey } from './services/memory/apiMemory.js';

let agent: BossAgent | null = null;

if (parentPort) {
    parentPort.on('message', async (data) => {
        if (data.command === 'start') {
            try {
                if (agent) {
                    console.warn(`Agent already running for session ${workerData.sessionId}`);
                    return;
                }

                const workerEventBus = eventBusManager.getOrCreateBus(data.agentConfig.sessionId);

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

            } catch (error) {
                console.error('❌ Worker agent error:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                parentPort?.postMessage({
                    type: 'error',
                    error: errorMessage
                });
            }
        }

        if (data.command === 'stop') {
            console.log(`🛑 Stopping agent ${workerData.sessionId}...`);

            if (agent) {
                await agent.stop();
                agent = null; // Clear the reference
            }

            deleteSession(workerData.sessionId);

            console.log(`✅ Agent stopped, terminating worker...`);
            process.exit(0);
        }
    });
}

console.log(`✅ Worker ready for session ${workerData.sessionId}`);