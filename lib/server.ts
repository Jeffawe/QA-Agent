import express, { Request, Response } from 'express';
import Session, { runTestSession } from './models/session.js';
import dotenv from 'dotenv';

import { getInteractiveElements } from './services/UIElementDetector.js';
import BossAgent from './agent.js';
import { eventBus } from './services/events/eventBus.js';

import { ActionSpamValidator } from './services/validators/actionValidator.js';
import { ErrorValidator } from './services/validators/errorValidator.js';
import { LLMUsageValidator } from './services/validators/llmValidator.js';
import { WebSocketEventBridge } from './services/events/webSockets.js';

dotenv.config();

const url = process.env.BASE_URL || 'https://www.jeffawe.com';
const app = express();
const PORT: number = parseInt(process.env.PORT || '3001');
const WebSocket_PORT: number = parseInt(process.env.WEBSOCKET_PORT || '3002');

let gameAgent: BossAgent | null = null;

// Validators
new ActionSpamValidator(eventBus);
new ErrorValidator(eventBus);
new LLMUsageValidator(eventBus);

// Setup WebSockets
new WebSocketEventBridge(eventBus, WebSocket_PORT);

app.get('/', (req: Request, res: Response) => {
    res.send('Hello, World!');
});

app.get('/start/:sessionId', async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    const gameSession = new Session(sessionId);
    gameAgent = new BossAgent({
        session: gameSession,
        eventBus: eventBus,
    });

    try {
        await gameAgent.start(url);
        res.send(`Game session ${sessionId} started successfully!`);
    } catch (error) {
        console.error('Error starting game session:', error);
        res.status(500).send('Failed to start game session.');
    }
});

app.get('/test', async (req: Request, res: Response) => {
    try {
        //await runTestSession(url);
        const session = new Session("3");
        const hasStarted = await session.start(url);

        if (!hasStarted) throw new Error('Failed to start test session');

        if (!session.page) throw new Error('Page not initialized');
        const elements = await getInteractiveElements(session.page);

        //await processScreenshot('./images/screenshot_0.png', elements);
        res.send('Test session started successfully!');
    }
    catch (error) {
        console.error('Error in test session:', error);
        res.status(500).send('Failed to start test session.');
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

eventBus.on('crawl_map_updated', async (evt) => {

})