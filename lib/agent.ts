import ActionService from './services/actions/actionService.js';
import Session from './models/session.js';
import { Thinker } from "./utility/abstract.js";
import { LogManager } from "./utility/logManager.js";
import { EventBus } from "./services/events/event.js";
import { State } from "./types.js";
import { CombinedThinker } from "./services/thinkers/combinedThinker.js";

import NavigationTree from "./utility/navigationTree.js";

import { Agent } from "./utility/abstract.js";
import { Crawler } from "./agent/crawler.js";
import Tester from "./agent/tester.js";
import { CrawlMap } from './utility/crawlMap.js';
import ManualTester from './agent/manualTester.js';

export interface AgentDependencies {
  session: Session;
  thinker?: Thinker;
  actionService?: ActionService;
  eventBus: EventBus;
  canvasSelector?: string;
}

export default class BossAgent {
  private readonly thinker: Thinker;
  private readonly actionService: ActionService;
  private readonly bus: EventBus;

  private readonly crawler: Crawler;
  private readonly tester: Tester;
  private readonly manualTester: ManualTester;

  public session: Session;
  public agents: Agent[] = [];

  // State Data
  public state: State = State.START;

  constructor({
    session,
    thinker,
    actionService,
    eventBus
  }: AgentDependencies) {
    this.session = session;
    this.thinker = thinker ?? new CombinedThinker();
    this.actionService = actionService ?? new ActionService(this.session);
    this.bus = eventBus;

    // Agents
    this.tester = new Tester({ session: this.session, thinker: this.thinker, actionService: this.actionService, eventBus: this.bus });
    this.manualTester = new ManualTester({ session: this.session, actionService: this.actionService, eventBus: this.bus });
    this.crawler = new Crawler(this.session, this.tester, this.manualTester, this.bus);

    this.agents = [this.crawler, this.tester, this.manualTester];
  }

  /** Public API */
  async start(url: string): Promise<void> {
    LogManager.initialize();
    NavigationTree.initialize();
    CrawlMap.init("logs/crawl_map.md");

    const started = await this.session.start(url);
    if (!started) return;

    this.crawler.setBaseUrl(url);
    this.actionService.setBaseUrl(url);

    while (this.agents.some(a => !a.isDone())) {
      for (const a of this.agents) {
        if (!a.isDone()) await a.tick();
      }
    }

    LogManager.log("Done", State.DONE, true);
    this.stop();
  }

  async stop(): Promise<boolean> {
    try {
      this.state = State.DONE;
      for (const a of this.agents) {
        await a.cleanup();
        a.state = State.DONE;
      }
      this.session.close();
      LogManager.log("All Services have been stopped", State.DONE, true);
      return true;
    } catch (err) {
      LogManager.error(`Error stopping agent: ${err}`, State.ERROR, true);
      return false;
    }
  }
}
