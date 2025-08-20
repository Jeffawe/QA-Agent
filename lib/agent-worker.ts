import { parentPort, workerData } from 'worker_threads';
import BossAgent from './agent.js';
import { eventBusManager } from './services/events/eventBus.js';
import { deleteSession } from './services/memory/sessionMemory.js';

let agent: BossAgent | null = null;

if (parentPort) {
    parentPort.on('message', async (data) => {
        if (data.command === 'start') {
            try {
                console.log(`🚀 Worker starting agent for session ${data.agentConfig.sessionId}`);

                // Recreate the agent in worker thread
                // NOTE: This creates a separate eventBus instance in worker
                // If you need the SAME eventBus, we'd need to pass it differently
                const workerEventBus = eventBusManager.getOrCreateBus(data.agentConfig.sessionId);

                agent = new BossAgent({
                    sessionId: data.agentConfig.sessionId,
                    eventBus: workerEventBus,
                    goalValue: data.agentConfig.goalValue,
                    agentConfigs: new Set(data.agentConfig.agentConfigs),
                });

                // THIS is the blocking call that now runs in worker thread
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
            }

            deleteSession(workerData.sessionId);

            console.log(`✅ Agent stopped, terminating worker...`);
            process.exit(0);
        }
    });
}

console.log(`✅ Worker ready for session ${workerData.sessionId}`);