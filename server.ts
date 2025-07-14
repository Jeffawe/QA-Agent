import express, { Request, Response } from 'express';
import Session, { runTestSession } from './models/session';
import Agent from './agent';
import dotenv from 'dotenv';

import { detectUIWithPython, getInteractiveElements } from './services/UIElementDetector';
import { LocalEventBus } from './utility/events/event';
import { LogManager } from './logManager';
import { processScreenshot } from './services/drawOnImage';

dotenv.config();

const url = "https://www.jeffawe.com";
const eventBus = new LocalEventBus();
const app = express();
const PORT: number = parseInt(process.env.PORT || '3000');

let gameAgent: Agent | null = null;

app.get('/', (req: Request, res: Response) => {
    res.send('Hello, World!');
});

app.get('/start-game/:sessionId', async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    const gameSession = new Session(sessionId);
    gameAgent = new Agent({
        session: gameSession,
        eventBus: eventBus,
    });

    try {
        await gameAgent.start('https://www.jeffawe.com');
        res.send(`Game session ${sessionId} started successfully!`);
    } catch (error) {
        console.error('Error starting game session:', error);
        res.status(500).send('Failed to start game session.');
    }
});

app.get('/detect-ui', async (req: Request, res: Response) => {
    try {
        const uiElements = detectUIWithPython('./images/screenshot_7.png');
        res.json(uiElements);
    } catch (error) {
        console.error('Error detecting UI:', error);
        res.status(500).send('Failed to detect UI elements.');
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

        await processScreenshot('./images/screenshot_0.png', elements);
        res.send('Test session started successfully!');
    }
    catch (error) {
        console.error('Error in test session:', error);
        res.status(500).send('Failed to start test session.');
    }
});

eventBus.on('error', async (evt) => {
    if (gameAgent) {
        LogManager.error(`Agent error: ${evt.message}`, gameAgent.state, false);
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});