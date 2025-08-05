import { AgentConfig } from "./agent";
import { Crawler } from "./agent/crawler";
import { GoalAgent } from "./agent/goalIntelliAgent";
import ManualTester from "./agent/manualTester";
import PlannerAgent from "./agent/plannerAgent";
import Tester from "./agent/tester";

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