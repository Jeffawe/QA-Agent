import { Router, Request, Response } from "express";
import StagehandSession from "../browserAuto/stagehandSession.js";
import { UIElementGrouper } from "../utility/links/linkGrouper.js";
import { BaseAgentDependencies } from "../utility/abstract.js";
import Tester from "../agent/tester.js";
import AutoActionService from "../services/actions/autoActionService.js";
import { eventBusManager } from "../services/events/eventBus.js";
import { TestingThinker } from "../services/thinkers/testingThinker.js";

const router = Router();

// GET /test/
router.get("/test-agent", async (req, res) => {
    try {
        console.log('Starting test session...');
        const sessionId = "test_session"
        const url = 'https://forms.gle/C5wE2k9fpHtC4561A';

        const session = new StagehandSession(sessionId);
        const started = await session.start(url);
        
        if (!started) {
            res.status(500).send('Failed to start session.');
            return;
        }
        if (!session.page) {
            res.status(500).send('Failed to start session.');
            return;
        }

        const eventBus = eventBusManager.getOrCreateBus(sessionId);
        const thinker = new TestingThinker(sessionId);
        const actionService = new AutoActionService(session);

        const dependencies: BaseAgentDependencies = {
            eventBus: eventBus,
            session: session,
            agentRegistry: undefined,
            dependent: false,
            sessionId: sessionId,
            thinker: thinker,
            actionService: actionService
        };

        const agent = new Tester(dependencies);
        agent.setBaseValues(url, 'Crawl the site');
        while (!agent.isDone()) {
            await agent.tick();
        }

        console.log(`✅ Results are:`, agent.testResults);

        await session.close();
        res.send('Test completed successfully!');
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }

});

router.get('/stuff', async (req: Request, res: Response) => {
    try {
        console.log('Starting test session...');
        const session = new StagehandSession('test_session');
        const started = await session.start('https://forms.gle/C5wE2k9fpHtC4561A');
        if (!started) {
            res.status(500).send('Failed to start session.');
            return;
        }
        const observations = await session.observe();
        console.log(observations);
        if (!session.page) {
            res.status(500).send('Failed to start session.');
            return;
        }
        const groupedElements = await UIElementGrouper.groupUIElements(observations, session.page);
        console.log(`Grouped Elements of page:`, groupedElements);
        await session.close();
        res.send('Test completed successfully!');
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }
});

// GET /test/ping
router.get("/ping", (req, res) => {
    res.json({ message: "pong" });
});

export default router;