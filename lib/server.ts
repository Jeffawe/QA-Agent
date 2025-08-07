import express, { Request, Response } from 'express';
import dotenv from 'dotenv';

import BossAgent, { AgentConfig } from './agent.js';
import { eventBus } from './services/events/eventBus.js';

import { ActionSpamValidator } from './services/validators/actionValidator.js';
import { ErrorValidator } from './services/validators/errorValidator.js';
import { LLMUsageValidator } from './services/validators/llmValidator.js';
import { WebSocketEventBridge } from './services/events/webSockets.js';
import { LogManager } from './utility/logManager.js';
import { State } from './types.js';
import { setAPIKey } from './externalCall.js';
import { exampleAgentConfigs, goalConfig } from './agentConfig.js';
import StagehandSession from './browserAuto/stagehandSession.js';

dotenv.config();

const url = process.env.BASE_URL || 'https://scanmyfood.vercel.app/';
const app = express();
const PORT: number = parseInt(process.env.PORT || '3001');
const WebSocket_PORT: number = parseInt(process.env.WEBSOCKET_PORT || '3002');

let sessions = new Map<string, BossAgent>();

// Validators
new ActionSpamValidator(eventBus);
new ErrorValidator(eventBus);
new LLMUsageValidator(eventBus);

// Setup WebSockets
new WebSocketEventBridge(eventBus, WebSocket_PORT);

app.get('/', (req: Request, res: Response) => {
    res.send('Welcome to QA-Agent! Go to https://www.qa-agent.site/ for more info.');
});

app.get('/start', (req: Request, res: Response) => {
    res.send('To start a session, use /start/:sessionId endpoint, where sessionId is a unique identifier for the session.');
});

app.get('/status', (req: Request, res: Response) => {
    res.json({
        sessions: Array.from(sessions.keys()),
    });
});

app.get('/start/:sessionId', async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    if (sessions.has(sessionId)) {
        LogManager.error('Session already started.', State.ERROR, true);
        res.status(400).send('Session already started.');
        return;
    }
    const agent = new BossAgent({
        sessionId: sessionId,
        eventBus: eventBus,
        agentConfigs: new Set<AgentConfig>(goalConfig),
    });
    sessions.set(sessionId, agent);

    if (process.env.API_KEY?.startsWith('TEST')) {
        const success = setAPIKey(process.env.API_KEY);
        if (!success) {
            LogManager.error('Failed to set API key.', State.ERROR, true);
            res.status(500).send('Failed to set API key.');
            return;
        }
    }

    if (!process.env.API_KEY) {
        LogManager.error('API key is not set. Please set the API_KEY environment variable.', State.ERROR, true);
        res.status(500).send('API key is not set. Please set the API_KEY environment variable.');
        return;
    }

    try {
        await agent.start(url);
        res.send(`Session ${sessionId} started successfully!`);
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }
});

app.get('/session-test', async (req: Request, res: Response) => {
    try {
        //await runTestSession(url);
        let session = new StagehandSession("test_session");

        const hasStarted = await session.start(url);

        if (!hasStarted) throw new Error('Failed to start test session');

        if (!session.page) throw new Error('Page not initialized');
        // const elements = await getInteractiveElements(session.page);

        session.testAgent(url);

        // await processScreenshot('./images/screenshot_0.png', elements);
        res.send('Test session started successfully!');
    }
    catch (error) {
        console.error('Error in test session:', error);
        res.status(500).send('Failed to start test session.');
    }
});

app.get('/stop/:sessionId', async (req: Request, res: Response) => {
    try {
        if (!sessions.has(req.params.sessionId)) {
            LogManager.error('Session not found.', State.ERROR, true);
            res.status(404).send('Session not found.');
            return;
        }

        const agent = sessions.get(req.params.sessionId);
        const hasStopped = await agent?.stop();

        if (!hasStopped) throw new Error('Failed to stop session');

        sessions.delete(req.params.sessionId);
        console.log(`Session ${req.params.sessionId} stopped successfully.`);
        res.send('Session stopped successfully!');
    } catch (error) {
        LogManager.error('Error stopping session: error', State.ERROR, true);
        res.status(500).send('Failed to stop session.');
    }
});

app.get('/stop', async (req: Request, res: Response) => {
    try {
        if (sessions.size === 0) {
            LogManager.error('No active sessions to stop.', State.ERROR, true);
            res.status(404).send('No active sessions to stop.');
            return;
        }
        for (const agent of sessions.values()) {
            await agent.stop();
        }
        sessions.clear();
        console.log('All sessions stopped successfully.');
        res.send('All sessions stopped successfully!');
    } catch (error) {
        LogManager.error('Error stopping sessions: error', State.ERROR, true);
        res.status(500).send('Failed to stop sessions.');
    }
})

app.get('/test/:key', async (req: Request, res: Response) => {
    const key = req.params.key;
    const sessionId = "test_" + key;
    if (sessions.has(sessionId)) {
        LogManager.error('Test Session already started.', State.ERROR, true);
        res.status(400).send('Test Session already started.');
        return;
    }
    const agent = new BossAgent({
        sessionId: sessionId,
        eventBus: eventBus,
        agentConfigs: new Set<AgentConfig>(exampleAgentConfigs),
    });
    sessions.set(sessionId, agent);

    const success = setAPIKey(key);
    if (!success) {
        LogManager.error('Failed to set API key.', State.ERROR, true);
        res.status(500).send('Failed to set a Test API key.');
        return;
    }

    try {
        await agent.start(url);
        res.send(`Test Session started successfully!`);
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});