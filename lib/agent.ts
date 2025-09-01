import { ActionService, AgentRegistry, BaseAgentDependencies, Session, Thinker } from "./utility/abstract.js";
import { LogManager } from "./utility/logManager.js";
import { EventBus } from "./services/events/event.js";
import { AgentConfig, Namespaces, State } from "./types.js";
import { CombinedThinker } from "./services/thinkers/combinedThinker.js";

import NavigationTree from "./utility/navigationTree.js";

import { Agent } from "./utility/abstract.js";
import { CrawlMap } from './utility/crawlMap.js';
import { clearAllImages } from './services/imageProcessor.js';
import { eventBusManager } from './services/events/eventBus.js';
import { logManagers } from './services/memory/logMemory.js';
import { ActionServiceFactory, SessionFactory } from "./agentFactory.js";

export interface AgentDependencies {
  sessionId: string;
  thinker?: Thinker;
  actionService?: ActionService;
  eventBus: EventBus;
  goalValue: string;
  canvasSelector?: string;
  agentConfigs: Set<AgentConfig>;
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
    this.sessionId = sessionId;
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
    try {
      // First pass: Create all agents without dependencies
      const agentInstances: Array<{ config: AgentConfig; agent: Agent }> = [];

      for (const config of agentConfigs) {
        try {
          if (!this.sessions.has(config.sessionType)) {
            const session = SessionFactory.createSession(config.sessionType, sessionId);
            this.sessions.set(config.sessionType, session);
          }

          // Retrieve existing or newly created session
          const session = this.sessions.get(config.sessionType)!;

          if (config.sessionType === 'stagehand') {
            config.actionServiceType = 'auto';
          }

          if (!config.actionServiceType) {
            config.actionServiceType = 'manual';
          }

          if (!this.actionServices.has(config.actionServiceType)) {
            const actionService = ActionServiceFactory.createActionService(config.actionServiceType, session);
            this.actionServices.set(config.actionServiceType, actionService);
          }

          // Retrieve existing or newly created action service
          const actionService = this.actionServices.get(config.actionServiceType)!;

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
      this.validateAgentDependencies(agentConfigs);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.logManager) {
        this.logManager.error(`Failed to initialize agents: ${errorMessage}`, State.ERROR);
      }
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
    const startTime = performance.now();
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
      this.stopLoop = true;
      this.bus.emit({ ts: Date.now(), type: 'issue', message: `Agent stopped because of ${evt.message}` });
      this.logManager.log(`Agent stopped because of ${evt.message}`, State.ERROR, true);
    });

    this.bus.on('pause_all', () => {
      this.pauseAllAgents();
    });

    this.bus.on('resume_all', () => {
      this.resumeAllAgents();
    });

    this.bus.on('pause_agent', (data: { agentName: Namespaces }) => {
      const agent = this.getAgent(data.agentName);
      if (agent) {
        agent.pauseAgent();
      }
    });

    this.bus.on('resume_agent', (data: { agentName: Namespaces }) => {
      const agent = this.getAgent(data.agentName);
      if (agent) {
        agent.resumeAgent();
      }
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

    while (agents.some(a => !a.isDone())) {
      if (this.stopLoop) {
        this.logManager.log("Stopping main loop as requested", State.INFO, true);
        break;
      }

      if (agents.every(a => a.isPaused())) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to avoid busy waiting
        continue; // Skip this iteration if all agents are paused
      }

      for (const agent of agents) {
        if (!agent.isDone()) {
          await agent.tick();
        }
      }
    }

    await this.stop();
    const doneMessage = `Agent is done with task. Used ${this.logManager.getTokens()} tokens`;
    this.bus.emit({ ts: Date.now(), type: "done", message: doneMessage, sessionId: this.sessionId });
    const endTime = performance.now();
    const timeTaken = endTime - startTime;
    this.logManager.log("Done", State.DONE, true);
    this.logManager.log(`All Agents finished in: ${timeTaken.toFixed(2)} ms`, State.DONE, true);
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
    //clearAllImages();
    this.sessions.clear();
    eventBusManager.removeBus(this.sessionId);
    //this.logManager.deleteLogFile();
    logManagers.removeManager(this.sessionId);
  }

  // Public API to get agents (useful for external orchestration)
  public getAgent<T extends Agent>(name: string): T | null {
    return this.agentRegistry.getAgent<T>(name);
  }

  public pauseAllAgents(): void {
    const agents = this.agentRegistry.getAllAgents();
    for (const agent of agents) {
      agent.pauseAgent();
    }
    this.logManager.log("All agents paused", State.PAUSE, true);
  }

  public resumeAllAgents(): void {
    const agents = this.agentRegistry.getAllAgents();
    for (const agent of agents) {
      agent.resumeAgent();
    }
    this.logManager.log("All agents resumed", State.RESUME, true);
  }
}