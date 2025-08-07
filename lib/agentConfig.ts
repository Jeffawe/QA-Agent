import { AgentConfig } from "./agent.js";
import { Crawler } from "./agent/crawler.js";
import { GoalAgent } from "./agent/goalIntelliAgent.js";
import ManualTester from "./agent/manualTester.js";
import PlannerAgent from "./agent/plannerAgent.js";
import Tester from "./agent/tester.js";

export const exampleAgentConfigs: AgentConfig[] = [
    {
        name: "crawler",
        agentClass: Crawler,
        sessionType: "puppeteer",
        dependent: false, // Starts immediately
        agentDependencies: ["tester", "manualTester"]
    },
    {
        name: "tester",
        agentClass: Tester,
        sessionType: "puppeteer",
        dependent: true, // Waits to be triggered by another agent
    },
    {
        name: "manualTester",
        agentClass: ManualTester,
        sessionType: "puppeteer",
        dependent: true, // Waits to be triggered
        agentDependencies: [] // No dependencies on other agents
    },
    {
        name: "goalagent",
        agentClass: GoalAgent,
        sessionType: "playwright",
        dependent: true,
    },
    {
        name: "planner",
        agentClass: PlannerAgent,
        sessionType: "playwright",
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