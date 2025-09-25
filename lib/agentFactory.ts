import Analyzer from './agent/analyzer.js';
import AutoAnalyzer from './agent/autoanalyzer.js';
import { AutoCrawler } from './agent/autocrawler.js';
import { Crawler } from './agent/crawler.js';
import EndPoints from './agent/endpoints.js';
import { GoalAgent } from './agent/goalIntelliAgent.js';
import ManualAnalyzer from './agent/manualAnalyzer.js';
import ManualAutoAnalyzer from './agent/manualAutoAnalyzer.js';
import PlannerAgent from './agent/plannerAgent.js';
import Tester from './agent/tester.js';
import PlaywrightSession from './browserAuto/playWrightSession.js';
import StagehandSession from './browserAuto/stagehandSession.js';
import ManualActionService from './services/actions/actionService.js';
import AutoActionService from './services/actions/autoActionService.js';
import { Namespaces } from './types.js';
import { ActionService, Agent, BaseAgentDependencies, Session } from './utility/abstract.js';

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
        this.agentClasses.set('autocrawler', AutoCrawler);
        this.agentClasses.set('autoanalyzer', AutoAnalyzer);
        this.agentClasses.set('manualAutoanalyzer', ManualAutoAnalyzer);
        this.agentClasses.set('endpointagent', EndPoints);
    }

    static getAgentClass(name: Namespaces): new (dependencies: BaseAgentDependencies) => Agent {
        const AgentClass = this.agentClasses.get(name);
        if (!AgentClass) {
            throw new Error(`Unknown agent type: ${name}`);
        }
        return AgentClass;
    }
}


// Session factory to create different types of sessions
export class SessionFactory {
    static createSession(type: string, sessionId: string): Session {
        switch (type) {
            case 'playwright':
                return new PlaywrightSession(sessionId);
            case 'stagehand':
                return new StagehandSession(sessionId);
            default:
                throw new Error(`Unknown session type: ${type}`);
        }
    }
}

export class ActionServiceFactory {
    /**
     * Creates an ActionService based on the given type. If the type is "manual",
     * it will create a ManualActionService using a PlaywrightSession. Otherwise,
     * it will do nothing.
     *
     * @param {string} type - The type of ActionService to create.
     * @param {Session} session - The session used by the ActionService.
     * @returns {ActionService} The created ActionService.
     */
    static createActionService(type: string, session: Session): ActionService {
        try {
            if (type === 'auto') {
                if (!(session instanceof StagehandSession)) {
                    throw new Error('Auto type requires StagehandSession');
                }
                return new AutoActionService(session);
            } else {
                if (!(session instanceof PlaywrightSession)) {
                    throw new Error('Manual type requires PlaywrightSession');
                }
                return new ManualActionService(session);
            }
        } catch (error) {
            throw new Error(`Failed to create ActionService: ${(error as Error).message}`);
        }
    }
}