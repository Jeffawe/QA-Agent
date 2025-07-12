import express, { Request, Response } from 'express';
import Session, { runTestSession } from './models/session';
import Agent from './agent';
import dotenv from 'dotenv';

import { detectUIWithPython } from './models/UIElementDetector';
import { LocalEventBus } from './utility/events/event';

dotenv.config();

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
        eventBus: new LocalEventBus(),
    });

    try {
        await gameAgent.start('https://4cats.itch.io/dungeon-raid');
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
        await runTestSession('https://4cats.itch.io/dungeon-raid');
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