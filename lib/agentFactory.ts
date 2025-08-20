
import Analyzer from './agent/analyzer.js';
import { Crawler } from './agent/crawler.js';
import { GoalAgent } from './agent/goalIntelliAgent.js';
import ManualAnalyzer from './agent/manualAnalyzer.js';
import PlannerAgent from './agent/plannerAgent.js';
import Tester from './agent/tester.js';
import { Namespaces } from './types.js';
import { Agent, BaseAgentDependencies } from './utility/abstract.js';

export class AgentFactory {
    private static agentClasses: Map<Namespaces, new (dependencies: BaseAgentDependencies) => Agent> = new Map();

    static {
        // Static initialization block
        this.agentClasses.set('goalagent', GoalAgent);
        this.agentClasses.set('planneragent', PlannerAgent);
        this.agentClasses.set('analyzer', Analyzer);
        this.agentClasses.set('tester', Tester);
        this.agentClasses.set('manualanalyzer', ManualAnalyzer);
        this.agentClasses.set('crawler', Crawler);
    }

    static getAgentClass(name: Namespaces): new (dependencies: BaseAgentDependencies) => Agent {
        const AgentClass = this.agentClasses.get(name);
        if (!AgentClass) {
            throw new Error(`Unknown agent type: ${name}`);
        }
        return AgentClass;
    }
}