import { Router, Request, Response } from "express";
import StagehandSession from "../browserAuto/stagehandSession.js";
import { UIElementGrouper } from "../utility/links/linkGrouper.js";
import { BaseAgentDependencies } from "../utility/abstract.js";
import Tester from "../agent/tester.js";
import AutoActionService from "../services/actions/autoActionService.js";
import { eventBusManager } from "../services/events/eventBus.js";
import { TestingThinker } from "../services/thinkers/testingThinker.js";
import EndPoints from "../agent/endpoints.js";
import PlaywrightSession from "../browserAuto/playWrightSession.js";
import ManualActionService from "../services/actions/actionService.js";
import { dataMemory } from "../services/memory/dataMemory.js";

const router: Router = Router();

router.get("/test-data", async (req, res) => {
    try {
        const data = {
            "header:x-api-key": "YB4mNsCgX3zDJ4SnWWeX",
            "/meta/adset/1345/create": {
                "query:campaign_id": "1345",
                "name": "Fall Clearance Sale",
                "main_goal": "sales",
                "start_date": "2025-10-01",
                "end_date": "2025-10-15",
                "expected_sales": 500,
                "expected_aov": 75,
                "daily_campaign_budget": 200,
                "location": [
                    "United States",
                    "Canada"
                ],
                "creative_notes": "Highlight urgency with limited-time discount messaging and warm autumn colors.",
                "landing_page_link": "https://example-store.com/fall-clearance",
                "client_name": "Autumn Apparel Co.",
                "image": "https://example-store.com/images/fall-campaign-banner.jpg",
                "store_uniqueness": "Trendy, affordable seasonal fashion with eco-friendly materials.",
                "why_choose_store": "Free shipping on all orders and a 30-day hassle-free return policy.",
                "ideal_customers": "Young professionals, college students, and eco-conscious shoppers.",
                "customer_problems_needs": "Affordable, stylish outfits for fall weather without compromising on sustainability.",
                "store_tone_personality": "Warm, approachable, trendy, eco-conscious.",
                "store_values_phrases": "Sustainable fashion for everyone, affordable style that lasts.",
                "total_ad_budget": 3000,
                "audience": [
                    "Eco-conscious millennials",
                    "College students",
                    "Young professionals interested in fashion"
                ],
                "youtube_links": "https://youtube.com/watch?v=fallcollectionpromo"
            },
            "/meta/adset/11112/create": {
                "query": {
                    "campaign_id": "1345"
                },
                "body": {
                    "name": "Fall Clearance Sale",
                    "main_goal": "sales",
                    "start_date": "2025-10-01",
                    "end_date": "2025-10-15",
                    "expected_sales": 500,
                    "expected_aov": 75,
                    "daily_campaign_budget": 200,
                    "location": [
                        "United States",
                        "Canada"
                    ],
                    "creative_notes": "Highlight urgency with limited-time discount messaging and warm autumn colors.",
                    "landing_page_link": "https://example-store.com/fall-clearance",
                    "client_name": "Autumn Apparel Co.",
                    "image": "https://example-store.com/images/fall-campaign-banner.jpg",
                    "store_uniqueness": "Trendy, affordable seasonal fashion with eco-friendly materials.",
                    "why_choose_store": "Free shipping on all orders and a 30-day hassle-free return policy.",
                    "ideal_customers": "Young professionals, college students, and eco-conscious shoppers.",
                    "customer_problems_needs": "Affordable, stylish outfits for fall weather without compromising on sustainability.",
                    "store_tone_personality": "Warm, approachable, trendy, eco-conscious.",
                    "store_values_phrases": "Sustainable fashion for everyone, affordable style that lasts.",
                    "total_ad_budget": 3000,
                    "audience": [
                        "Eco-conscious millennials",
                        "College students",
                        "Young professionals interested in fashion"
                    ],
                    "youtube_links": "https://youtube.com/watch?v=fallcollectionpromo"
                }
            }
        }
        dataMemory.loadData(data);
        console.log('Data loaded into memory');
        console.log("Endpoints: " + JSON.stringify(dataMemory.getAllEndpoints(), null, 2));
        console.log("Data: " + JSON.stringify(dataMemory.getAllData(), null, 2));
        res.json({ message: "Data loaded into memory.", data: dataMemory.getAllData() });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }
});

router.get("/test-agent", async (req, res) => {
    try {
        console.log('Starting test session...');
        const sessionId = "test_session"
        const url = 'https://ai.shoppingadssolutions.com';
        process.env.API_KEY = process.env.TEST_API_KEY || '';

        const session = new PlaywrightSession(sessionId);
        const started = await session.start(url);

        if (!started) {
            res.status(500).send('Failed to start session.');
            return;
        }
        if (!session.page) {
            res.status(500).send('Failed to start session.');
            return;
        }

        dataMemory.setData("header:x-api-key", "YB4mNsCgX3zDJ4SnWWeX");

        const eventBus = eventBusManager.getOrCreateBus();
        const thinker = new TestingThinker(sessionId);
        const actionService = new ManualActionService(session);

        const dependencies: BaseAgentDependencies = {
            eventBus: eventBus,
            session: session,
            agentRegistry: undefined,
            dependent: false,
            sessionId: sessionId,
            thinker: thinker,
            actionService: actionService
        };

        const agent = new EndPoints(dependencies);
        agent.setBaseValues(url, 'Crawl the site');
        while (!agent.isDone()) {
            await agent.tick();
        }

        console.log('✅ Full EndpointMap:');
        const map = agent.endpointMap;
        if (!map) {
            res.status(500).send('No endpoint map found.');
            return;
        }
        for (const [key, value] of Object.entries(map)) {
            console.log(`Endpoint: ${key}`);
            console.log(`Details: ${JSON.stringify(value, null, 2)}`);
        }
        console.log('✅ Full Results:');
        console.log(JSON.stringify(agent.results, null, 2));

        await session.close();
        agent.cleanup();
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