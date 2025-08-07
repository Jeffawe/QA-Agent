import { AgentConfig } from "./agent.js";
import { Crawler } from "./agent/crawler.js";
import { GoalAgent } from "./agent/goalIntelliAgent.js";
import ManualTester from "./agent/manualTester.js";
import PlannerAgent from "./agent/plannerAgent.js";
import Tester from "./agent/tester.js";
import { pipeline } from '@xenova/transformers';
import { ExtractorOptions } from "./types.js";
// Ensure ExtractorOptions uses: pooling: "mean" | "cls" | "none"

export const allAgents: AgentConfig[] = [
    {
        name: "crawler",
        agentClass: Crawler,
        sessionType: "playwright",
        dependent: false, // Starts immediately
        agentDependencies: ["tester", "manualTester"]
    },
    {
        name: "tester",
        agentClass: Tester,
        sessionType: "playwright",
        dependent: true, // Waits to be triggered by another agent
    },
    {
        name: "manualTester",
        agentClass: ManualTester,
        sessionType: "playwright",
        dependent: true, // Waits to be triggered
        agentDependencies: [] // No dependencies on other agents
    },
    {
        name: "goalagent",
        agentClass: GoalAgent,
        sessionType: "stagehand",
        dependent: true,
    },
    {
        name: "planner",
        agentClass: PlannerAgent,
        sessionType: "stagehand",
        dependent: false,
        agentDependencies: ["goalagent"]
    }
];

export const goalConfig: AgentConfig[] = [
    {
        name: "goalagent",
        agentClass: GoalAgent,
        sessionType: "stagehand",
        dependent: true,
    },
    {
        name: "planner",
        agentClass: PlannerAgent,
        sessionType: "stagehand",
        dependent: false,
        agentDependencies: ["goalagent"]
    }
];

export const crawlerConfig: AgentConfig[] = [
    {
        name: "crawler",
        agentClass: Crawler,
        sessionType: "playwright",
        dependent: false, // Starts immediately
        agentDependencies: ["tester", "manualTester"]
    },
    {
        name: "tester",
        agentClass: Tester,
        sessionType: "playwright",
        dependent: true, // Waits to be triggered by another agent
    },
    {
        name: "manualTester",
        agentClass: ManualTester,
        sessionType: "playwright",
        dependent: true, // Waits to be triggered
        agentDependencies: [] // No dependencies on other agents
    }
];

export const getAgents = async (goal: string): Promise<AgentConfig[]> => {
    const message = "Crawl the entire page"
    const options: ExtractorOptions = { pooling: 'mean', normalize: true };

    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    const [goalVec, progressVec] = await Promise.all([
        extractor(goal, options),
        extractor(message, options)
    ]);

    const progressSimilarity = cosineSimilarity(Array.from(goalVec.data), Array.from(progressVec.data));
    if (progressSimilarity > 0.8) {
        return crawlerConfig;
    }
    return goalConfig;
}

export const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
    if (vecA.length !== vecB.length) {
        throw new Error('Vectors must have the same length');
    }

    return vecA.reduce((acc: number, v: number, i: number) => acc + v * vecB[i], 0);
}