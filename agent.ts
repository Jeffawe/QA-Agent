import { setTimeout } from "node:timers/promises";
import ActionService from './services/actionService';
import Session from './models/session.js';
import VisionModel from './models/visionModel';
import LLMCommander from './models/llmModel';
import { Thinker } from "./abstract";
import { LogManager } from "./logManager";
import { getInteractiveElements } from "./services/UIElementDetector";
import { EventBus } from "./utility/events/event";
import { Action, State, ImageData, PageDetails } from "./types";
import { CombinedThinker } from "./thinkers/combinedThinker";

import { performance } from 'perf_hooks';
import { getImageHash, processScreenshot } from "./services/imageProcessor";
import NavigationTree from "./services/navigationTree";
import { StaticMemory } from "./services/memory/staticMemory";

export interface AgentDependencies {
  session: Session;
  visionModel?: VisionModel;
  llmCommander?: LLMCommander;
  thinker?: Thinker;
  actionService?: ActionService;
  eventBus: EventBus;
  canvasSelector?: string;
}

export default class Agent {
  private readonly session: Session;
  private readonly thinker: Thinker;
  private readonly actionService: ActionService;
  private readonly visionModel: VisionModel;
  private readonly llmCommander: LLMCommander;
  private readonly bus: EventBus;

  // State Data
  public state: State = State.START;
  private step = 0;
  private response = "";
  private currentPage: PageDetails | null = null;
  private timeTaken = 0;

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
  }

  /** Public API */
  async start(url: string): Promise<void> {
    LogManager.initialize();
    NavigationTree.initialize();
    const started = await this.session.start(url);
    if (!started) return;

    while (this.state !== State.DONE) {
      const prev = this.state;
      // route through one state tick
      this.state = await this.tick(this.state);
      this.bus.emit({ ts: Date.now(), type: "state_transition", from: prev, to: this.state });
    }
  }

  /** One FSM transition */
  private async tick(state: State): Promise<State> {
    try {
      switch (state) {
        case State.START:
          (this as any).startTime = performance.now();
          return State.OBSERVE;

        case State.OBSERVE: {
          await this.session.clearAllClickPoints();
          const filename = `screenshot_${this.step}.png`;
          const success = await this.session.takeScreenshot("images", filename);
          if (!success) {
            LogManager.error("Screenshot failed", this.state);
            return State.DONE;
          }

          const elements = await getInteractiveElements(this.session.page!);
          await processScreenshot(`./images/${filename}`, elements);

          LogManager.log(`Elements detected: ${elements.length} are: ${JSON.stringify(elements)}`, this.state, false);
          (this as any).clickableElements = elements;

          (this as any).labels = elements.map((element) => element.label);
          LogManager.log(`Labels detected: ${(this as any).labels.length} are: ${JSON.stringify((this as any).labels)}`, this.state, false);

          (this as any).finalFilename = `images/annotated_${filename}`;
          this.bus.emit({ ts: Date.now(), type: "screenshot_taken", filename: (this as any).finalFilename, elapsedMs: 0 });

          this.currentPage = {
            url: this.session.page?.url(),
            title: "",
            uniqueID: getImageHash(`./images/${filename}`),
            description: "",
          };

          return State.DECIDE;
        }

        case State.DECIDE: {
          const nextActionContext = {
            goal: "Crawl every internal page of the target site",
            vision: "",
            lastAction: null,
            memory: [],
            possibleLabels: (this as any).labels,
          };

          const imageData: ImageData = {
            imagepath: (this as any).finalFilename,
          };

          LogManager.addMission(nextActionContext.goal);

          const command = await this.thinker.think(nextActionContext, imageData, this.response);
          if (!command?.action) {
            LogManager.error("Thinker produced no action", this.state, false);
            return State.DONE;
          }
          (this as any).pendingAction = command.action;

          if (this.currentPage) {
            this.currentPage.title = this.resolvePageTitle(command.pageDetails?.pageName || " ", this.currentPage.url || "");
            this.currentPage.description = command.pageDetails?.description || ""
          }

          return State.ACT;
        }

        case State.ACT: {
          const action: Action = (this as any).pendingAction;
          const t0 = Date.now();
          this.bus.emit({ ts: t0, type: "action_started", action });

          try {
            await this.actionService.executeAction(action, (this as any).clickableElements);
          } catch (error) {
            LogManager.error(String(error), this.state, false);
            this.bus.emit({ ts: Date.now(), type: "error", message: String(error), stack: (error as Error).stack });
            return State.DONE;
          }

          this.bus.emit({ ts: Date.now(), type: "action_finished", action, elapsedMs: Date.now() - t0 });
          this.response = action.response ?? "";
          this.step++;
          await setTimeout(1000);

          const endTime = performance.now();
          this.timeTaken = endTime - (this as any).startTime;
          LogManager.log(`Time taken: ${this.timeTaken.toFixed(2)} ms`, this.state, false);

          if (this.currentPage) {
            NavigationTree.addPage(this.currentPage.title, this.currentPage.description, this.currentPage.url || "", { loadTime: `${this.timeTaken.toFixed(2)} ms` });
          }

          StaticMemory.addPage(this.currentPage!);

          return State.OBSERVE;
        }

        default:
          return State.DONE;
      }
    } catch (error) {
      this.bus.emit({ ts: Date.now(), type: "error", message: String(error), stack: (error as Error).stack });
      return State.DONE;
    }
  }

  async stop(): Promise<void> {
    this.state = State.DONE;
  }

  async cleanup(): Promise<void> {}

  resolvePageTitle(title: string, uniqueID: string): string {
    const matchByID = StaticMemory.pages.find(p => p.uniqueID === uniqueID);
    if (matchByID) return matchByID.title;

    const titleExists = StaticMemory.pages.some(p => p.title === title);
    if (titleExists) return uniqueID;

    return title || uniqueID;
  }
}
