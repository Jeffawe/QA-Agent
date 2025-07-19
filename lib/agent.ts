import ActionService from './services/actions/actionService.js';
import Session from './models/session.js';
import VisionModel from './models/visionModel.js';
import LLMCommander from './models/llmModel.js';
import { Thinker } from "./utility/abstract.js";
import { LogManager } from "./utility/logManager.js";
import { EventBus } from "./services/events/event.js";
import { State } from "./types.js";
import { CombinedThinker } from "./services/thinkers/combinedThinker.js";

import NavigationTree from "./utility/navigationTree.js";

import { Agent } from "./utility/abstract.js"
import { Crawler } from "./agent/crawler.js";
import Tester from "./agent/tester.js";
import { CrawlMap } from './utility/crawlMap.js';

export interface AgentDependencies {
  session: Session;
  visionModel?: VisionModel;
  llmCommander?: LLMCommander;
  thinker?: Thinker;
  actionService?: ActionService;
  eventBus: EventBus;
  canvasSelector?: string;
}

export default class BossAgent {
  private readonly session: Session;
  private readonly thinker: Thinker;
  private readonly actionService: ActionService;
  private readonly visionModel: VisionModel;
  private readonly llmCommander: LLMCommander;
  private readonly bus: EventBus;

  private readonly crawler: Crawler;
  private readonly tester: Tester;

  public agents: Agent[] = [];

  // State Data
  public state: State = State.START;

  constructor({
    session,
    visionModel = new VisionModel(),
    llmCommander = new LLMCommander(),
    thinker,
    actionService,
    eventBus
  }: AgentDependencies) {
    this.session = session;
    this.visionModel = visionModel;
    this.llmCommander = llmCommander;
    this.thinker = thinker ?? new CombinedThinker();
    this.actionService = actionService ?? new ActionService(this.session);
    this.bus = eventBus;

    this.tester = new Tester({ session: this.session, thinker: this.thinker, actionService: this.actionService, eventBus: this.bus });
    this.crawler = new Crawler(this.session, this.tester, this.bus);

    this.agents = [this.crawler, this.tester];
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

  async stop(): Promise<void> {
    this.state = State.DONE;
    for (const a of this.agents) {
      await a.cleanup();
    }
    this.session.close();
  }
}
