import ActionService from './services/actions/actionService.js';
import { AgentRegistry, BaseAgentDependencies, Session, Thinker } from "./utility/abstract.js";
import { LogManager } from "./utility/logManager.js";
import { EventBus } from "./services/events/event.js";
import { State } from "./types.js";
import { CombinedThinker } from "./services/thinkers/combinedThinker.js";

import NavigationTree from "./utility/navigationTree.js";

import { Agent } from "./utility/abstract.js";
import { CrawlMap } from './utility/crawlMap.js';
import StagehandSession from './browserAuto/stagehandSession.js';
import PlaywrightSession from './browserAuto/playWrightSession.js';
import { clearAllImages } from './services/imageProcessor.js';
import { eventBusManager } from './services/events/eventBus.js';
import { logManagers } from './services/memory/logMemory.js';
import { deleteSessionApiKey } from './services/memory/apiMemory.js';

export interface AgentConfig<T extends BaseAgentDependencies = BaseAgentDependencies> {
  name: string;
  agentClass: new (dependencies: T) => Agent;
  sessionType: 'puppeteer' | 'playwright' | 'selenium' | 'stagehand' | 'custom';
  dependent?: boolean; // If true, agent won't start until another agent triggers it
  dependencies?: Partial<T>; // Additional/override dependencies
  agentDependencies?: string[]; // Names of other agents this agent depends on
}

export interface AgentDependencies {
  sessionId: string;
  thinker?: Thinker;
  actionService?: ActionService;
  eventBus: EventBus;
  goalValue: string;
  canvasSelector?: string;
  agentConfigs: Set<AgentConfig>;
}

// Session factory to create different types of sessions
class SessionFactory {
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

export default class BossAgent {
  private readonly thinker: Thinker;
  private readonly bus: EventBus;
  private readonly agentRegistry: AgentRegistry;
  private stopLoop: boolean = false;
  protected logManager: LogManager;

  public sessions: Map<string, Session> = new Map();
  public actionServices: Map<string, ActionService> = new Map();
  public sessionId: string = "1";
  public state: State = State.START;
  public goal: string = "";

  constructor({
    sessionId,
    thinker,
    eventBus,
    goalValue,
    agentConfigs
  }: {
    sessionId: string;
    thinker?: Thinker;
    eventBus: EventBus;
    goalValue: string;
    agentConfigs: Set<AgentConfig>;
  }) {
    this.sessionId = sessionId ?? "1";
    this.logManager = logManagers.getOrCreateManager(sessionId);
    try {
      this.thinker = thinker ?? new CombinedThinker(sessionId);
    } catch (error) {
      this.logManager.error(`Failed to create thinker: ${(error as Error).message}`, State.ERROR, true);
      throw error;
    }
    this.bus = eventBus;
    this.goal = goalValue;
    this.agentRegistry = new AgentRegistry();
    this.stopLoop = false;

    this.initializeAgents(sessionId, agentConfigs);
  }

  private initializeAgents(sessionId: string, agentConfigs: Set<AgentConfig>): void {
    // First pass: Create all agents without dependencies
    const agentInstances: Array<{ config: AgentConfig; agent: Agent }> = [];

    for (const config of agentConfigs) {
      try {
        if (!this.sessions.has(sessionId)) {
          const session = SessionFactory.createSession(config.sessionType, sessionId);
          this.sessions.set(sessionId, session);
        }

        // Retrieve existing or newly created session
        const session = this.sessions.get(sessionId)!;

        const actionService = new ActionService(session as PlaywrightSession);
        this.actionServices.set(config.name, actionService);

        const baseDependencies: BaseAgentDependencies = {
          session,
          thinker: this.thinker,
          sessionId,
          actionService,
          eventBus: this.bus,
          agentRegistry: this.agentRegistry,
          dependent: config.dependent ?? false,
        };

        const agent = new config.agentClass(baseDependencies);
        agentInstances.push({ config, agent });

        // Register the agent immediately so other agents can reference it
        this.agentRegistry.register(config.name, agent);

        this.logManager.log(`Initialized agent: ${config.name}`, State.INFO);
      } catch (error) {
        this.logManager.error(`Failed to initialize agent ${config.name}: ${error}`, State.ERROR);
        throw error;
      }
    }

    // Second pass: Validate agent dependencies
    try {
      this.validateAgentDependencies(agentConfigs);
    } catch (error) {
      throw error;
    }
  }

  private validateAgentDependencies(agentConfigs: Set<AgentConfig>): void {
    for (const config of agentConfigs) {
      if (config.agentDependencies) {
        for (const depName of config.agentDependencies) {
          if (!this.agentRegistry.hasAgent(depName)) {
            this.logManager.error(`Agent '${config.name}' depends on '${depName}' but it was not found`, State.ERROR);
            throw new Error(`Agent '${config.name}' depends on '${depName}' but it was not found`);
          }
        }
      }
    }
  }

  public async start(url: string): Promise<void> {
    this.logManager.initialize();
    NavigationTree.initialize();
    CrawlMap.init(`logs/crawl_map_${this.sessionId}.md`);

    // Start all sessions
    for (const [name, session] of this.sessions.entries()) {
      const started = await session.start(url);
      if (!started) {
        this.logManager.error(`Failed to start session for agent: ${name}`, State.ERROR);
        return;
      }
    }

    this.bus.on('stop', async (evt) => {
      await this.stop();
      this.stopLoop = true;
      this.logManager.log(`Agent stopped because of ${evt.message}`, State.ERROR, true);
    });

    // Set base URL for all action services
    for (const actionService of this.actionServices.values()) {
      actionService.setBaseUrl(url);
    }

    const agents = this.agentRegistry.getAllAgents();

    if (agents.length === 0) {
      this.logManager.error("No agents registered to run", State.ERROR, true);
      return;
    }

    if (!this.goal) {
      this.logManager.error("Goal is not set", State.ERROR, true);
      return;
    }

    // Set base values for all agents
    for (const agent of agents) {
      agent.setBaseValues(url, this.goal);
    }

    while (agents.some(a => !a.isDone()) && !this.stopLoop) {
      for (const agent of agents) {
        if (!agent.isDone()) {
          await agent.tick();
        }
      }
    }

    this.logManager.log("Done", State.DONE, true);
    await this.stop();
    const doneMessage = `Agent is done with task. Used ${this.logManager.getTokens()} tokens`;
    this.bus.emit({ ts: Date.now(), type: "done", message: doneMessage });
  }

  public async stop(): Promise<boolean> {
    try {
      this.state = State.DONE;

      const agents = this.agentRegistry.getAllAgents();
      for (const agent of agents) {
        await agent.cleanup();
        agent.state = State.DONE;
      }

      for (const session of this.sessions.values()) {
        await session.close();
      }

      this.cleanup();
      this.logManager.log("All Services have been stopped", State.DONE, true);
      return true;
    } catch (err) {
      this.logManager.error(`Error stopping agent: ${err}`, State.ERROR, true);
      return false;
    }
  }

  cleanup() {
    this.agentRegistry.clear();
    clearAllImages();
    this.sessions.clear();
    deleteSessionApiKey(this.sessionId);
    eventBusManager.removeBus(this.sessionId);
    logManagers.removeManager(this.sessionId);
  }

  // Public API to get agents (useful for external orchestration)
  public getAgent<T extends Agent>(name: string): T | null {
    return this.agentRegistry.getAgent<T>(name);
  }
}