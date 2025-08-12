import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';

import BossAgent, { AgentConfig } from './agent.js';
import { eventBus } from './services/events/eventBus.js';

import { ActionSpamValidator } from './services/validators/actionValidator.js';
import { ErrorValidator } from './services/validators/errorValidator.js';
import { LLMUsageValidator } from './services/validators/llmValidator.js';
import { WebSocketEventBridge } from './services/events/webSockets.js';
import { LogManager } from './utility/logManager.js';
import { State } from './types.js';
import { setAPIKey } from './externalCall.js';
import { getAgents } from './agentConfig.js';
import StagehandSession from './browserAuto/stagehandSession.js';
import { encrypt } from './enctyption.js';
import { storeSessionApiKey } from './apiMemory.js';

dotenv.config();

const app = express();
const PORT: number = parseInt(process.env.PORT || '3001');
const WebSocket_PORT: number = parseInt(process.env.WEBSOCKET_PORT || '3002');

const baseUrl = process.env.BASE_URL || 'https://scanmyfood.vercel.app/';
const goal = process.env.USER_GOAL;

let sessions = new Map<string, BossAgent>();

// Validators
new ActionSpamValidator(eventBus);
new ErrorValidator(eventBus);
new LLMUsageValidator(eventBus);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Setup WebSockets
new WebSocketEventBridge(eventBus, WebSocket_PORT);

app.get('/', (req: Request, res: Response) => {
    res.send('Welcome to QA-Agent! Go to https://www.qa-agent.site/ for more info.');
});

app.get('/start', (req: Request, res: Response) => {
    try {
        if (sessions.size >= parseInt(process.env.MAX_SESSIONS ?? '10')) {
            res.status(429).send('We have reached the maximum number of sessions. Try again another time');
        }

        const sessionId = uuidv4();
        res.json({ sessionId });

    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }
});

app.post('/start/:sessionId', async (req: Request, res: Response) => {
    const { goal, url } = req.body;
    const sessionId = req.params.sessionId;
    if (sessions.has(sessionId)) {
        LogManager.error('Session already started.', State.ERROR, true);
        res.status(400).send('Session already started.');
        return;
    }

    if (!goal) {
        LogManager.error('USER_GOAL is not set. Please set the USER_GOAL environment variable.', State.ERROR, true);
        res.status(500).send('USER_GOAL is not set. Please set the USER_GOAL environment variable.');
        return;
    }

    const agents = await getAgents(goal);
    const agent = new BossAgent({
        sessionId: sessionId,
        eventBus: eventBus,
        goalValue: goal,
        agentConfigs: new Set<AgentConfig>(agents),
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

        const hasStarted = await session.start(baseUrl);

        if (!hasStarted) throw new Error('Failed to start test session');

        if (!session.page) throw new Error('Page not initialized');
        // const elements = await getInteractiveElements(session.page);

        session.testAgent(baseUrl);

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
        process.exit(0);
    } catch (error) {
        LogManager.error('Error stopping sessions: error', State.ERROR, true);
        res.status(500).send('Failed to stop sessions.');
        process.exit(1);
    }
})

app.post('/test/:key', async (req: Request, res: Response) => {
    const { goal, url } = req.body;
    const key = req.params.key;
    const sessionId = "test_" + key;
    if (sessions.has(sessionId)) {
        LogManager.error('Test Session already started.', State.ERROR, true);
        res.status(400).send('Test Session already started.');
        return;
    }

    if (!goal) {
        LogManager.error('USER_GOAL is not set. Please set the USER_GOAL environment variable.', State.ERROR, true);
        res.status(500).send('USER_GOAL is not set. Please set the USER_GOAL environment variable.');
        return;
    }

    const agents = await getAgents(goal);
    const agent = new BossAgent({
        sessionId: sessionId,
        eventBus: eventBus,
        goalValue: goal,
        agentConfigs: new Set<AgentConfig>(agents),
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

// Endpoint to receive and encrypt API key
app.post('/setup-key/:sessionId', (req: Request, res: Response) => {
    try {
        const { apiKey } = req.body;
        const { sessionId } = req.params;

        if (!apiKey) {
            res.status(400).json({ error: 'API key is required' });
            return;
        }

        if (!sessionId) {
            res.status(400).json({ error: 'Session ID is required' });
            return;
        }

        const encryptedData = encrypt(apiKey);

        // Store encrypted key mapped to sessionId
        storeSessionApiKey(sessionId, encryptedData);

        res.json({
            success: true,
            message: 'API key stored securely',
            sessionId
        });

    } catch (error) {
        console.error('❌ Error storing API key:', error);
        res.status(500).json({ error: 'Failed to store API key' });
    }
});



app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});