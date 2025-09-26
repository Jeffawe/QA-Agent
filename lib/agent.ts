import { ActionService, AgentRegistry, BaseAgentDependencies, Session, Thinker } from "./utility/abstract.js";
import { LogManager } from "./utility/logManager.js";
import { EventBus } from "./services/events/event.js";
import { AgentConfig, Namespaces, State } from "./types.js";
import { CombinedThinker } from "./services/thinkers/combinedThinker.js";

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

    this.logManager.initialize();

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
    try {
      const startTime = performance.now();
      CrawlMap.init(`logs/crawl_map_${this.sessionId}.md`);

      console.log("STEP 1 AGENT: 🌟 Starting all sessions...");

      // Start all sessions
      const sessionPromises = Array.from(this.sessions.entries()).map(async ([name, session]) => {
        const started = await session.start(url);
        if (!started) {
          throw new Error(`Failed to start session for agent: ${name}`);
        }
        return { name, started };
      });

      try {
        await Promise.all(sessionPromises);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logManager.error(errorMessage, State.ERROR);
        return;
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

      console.log(`STEP 2 AGENT: 🧠 Starting agents with goal: ${this.goal}`);

      let encounteredError = false;
      await this.loop(agents, encounteredError);
      // while (agents.some(a => !a.isDone())) {
      //   if (this.stopLoop) {
      //     this.logManager.log("Stopping main loop as requested", State.INFO, true);
      //     break;
      //   }

      //   if (agents.every(a => a.isPaused())) {
      //     await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to avoid busy waiting
      //     continue; // Skip this iteration if all agents are paused
      //   }

      //   for (const agent of agents) {
      //     agent.nextTick();
      //     if (!agent.isDone()) {
      //       await agent.tick();
      //     } else {
      //       if (agent.getState() == State.ERROR) {
      //         encounteredError = true
      //         this.bus.emit({ ts: Date.now(), type: "stop", message: `There was an error with ${agent.name} agent`, sessionId: this.sessionId });
      //         break;
      //       }
      //     }
      //   }

      //   if (encounteredError) break;
      // }

      this.logManager.log("Done", State.DONE, true);
      const doneMessage = `Agent is done with task. Used ${this.logManager.getTokens()} tokens`;
      this.bus.emit({ ts: Date.now(), type: "done", message: doneMessage, sessionId: this.sessionId });
      await this.stop();
      const endTime = performance.now();
      const timeTaken = endTime - startTime;
      this.logManager.log(`All Agents finished in: ${timeTaken.toFixed(2)} ms`, State.DONE, true);
    }
    catch (error) {
      this.logManager.error(`Error starting agent: ${error}`, State.ERROR, true);
      await this.stop();
      throw error;
    }
  }

  private async loop(agents: Agent[], encounteredError: boolean) {
    while (agents.some(a => !a.isDone())) {
      if (this.stopLoop) {
        this.logManager.log("Stopping main loop as requested", State.INFO, true);
        break;
      }

      if (agents.every(a => a.isPaused())) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to avoid busy waiting
        continue; // Skip this iteration if all agents are paused
      }

      // Separate agents into dependent and non-dependent
      const dependentAgents = agents.filter(agent => agent.dependent && !agent.isDone());
      const nonDependentAgents = agents.filter(agent => !agent.dependent && !agent.isDone());

      // Process non-dependent agents in parallel (they orchestrate their own dependent agents)
      const nonDependentPromises = nonDependentAgents.map(async (agent) => {
        try {
          agent.nextTick();
          if (!agent.isDone()) {
            await agent.tick();
          }
          return { agent, success: true, error: null };
        } catch (error) {
          return { agent, success: false, error };
        }
      });

      // Wait for all non-dependent agents to complete their tick FIRST
      const nonDependentResults = await Promise.all(nonDependentPromises);

      // THEN process dependent agents sequentially (they mostly stay inactive until called)
      const dependentResults = [];
      for (const agent of dependentAgents) {
        try {
          agent.nextTick();
          if (!agent.isDone()) {
            await agent.tick();
          }
          dependentResults.push({ agent, success: true, error: null });
        } catch (error) {
          dependentResults.push({ agent, success: false, error });
          break; // Stop processing dependent agents on first error
        }
      }

      // Check for errors in all results
      const allResults = [...nonDependentResults, ...dependentResults];
      for (const result of allResults) {
        if (!result.success || result.agent.getState() === State.ERROR) {
          encounteredError = true;
          this.bus.emit({
            ts: Date.now(),
            type: "stop",
            message: `There was an error with ${result.agent.name} agent`,
            sessionId: this.sessionId
          });
          break;
        }
      }

      if (encounteredError) break;
    }
  }

  public async stop(): Promise<boolean> {
    try {
      this.state = State.DONE;

      const agents = this.agentRegistry.getAllAgents();
      for (const agent of agents) {
        await agent.cleanup();
        agent.setState(State.DONE)
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
    eventBusManager.removeBus();
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