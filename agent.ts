import { setTimeout } from "node:timers/promises";
import ActionService from './services/actionService';
import Session from './models/session.js';
import VisionModel from './models/visionModel';
import LLMCommander from './models/llmModel';
import { Thinker } from "./abstract";
import { LogManager } from "./logManager";
import { detectUIWithPython, getDOMBoundingBoxes, matchBoxes } from "./models/UIElementDetector";
import { EventBus } from "./utility/events/event";
import { Action, State, ImageData } from "./types";
import { CombinedThinker } from "./thinkers/combinedThinker";

import { performance } from 'perf_hooks';

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
  private state: State = State.START;
  private step = 0;
  private response = "";
  private oldPageName = "";
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
    this.oldPageName = "Landing Page";
    LogManager.addInitialPage("Landing Page");
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

          (this as any).finalFilename = `images/${filename}`;
          this.bus.emit({ ts: Date.now(), type: "screenshot_taken", filename: (this as any).finalFilename, elapsedMs: 0 });

          const boxes = detectUIWithPython((this as any).finalFilename);

          // Get DOM boxes
          const domBoxes = await getDOMBoundingBoxes(this.session.page!);

          // Match them
          const matches = matchBoxes(boxes, domBoxes);

          // Filter for clickable elements
          const clickableMatches = matches.filter(match => match.domElement.isClickable);

          (this as any).allMatches =  {
            allMatches: matches,
            clickableElements: clickableMatches
          };

          LogManager.log(`✅ UI elements detected: ${clickableMatches}`, this.state, true);

          if (!boxes?.length) {
            LogManager.error("No UI elements detected; finishing run.", this.state);
            return State.DONE;
          }
          // store for decide phase
          (this as any).boxes = boxes;
          return State.DECIDE;
        }

        case State.DECIDE: {
          const nextActionContext = {
            goal: "Crawl every internal page of the target site",
            vision: "",
            lastAction: null,
            memory: [],
            boxData: (this as any).boxes,
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
          (this as any).pageName = command.pageName;
          return State.ACT;
        }

        case State.ACT: {
          const action: Action = (this as any).pendingAction;
          const t0 = Date.now();
          this.bus.emit({ ts: t0, type: "action_started", action });
          await this.actionService.executeAction(action, (this as any).allMatches.clickableElements);
          this.bus.emit({ ts: Date.now(), type: "action_finished", action, elapsedMs: Date.now() - t0 });
          this.response = action.response ?? "";
          this.step++;
          await setTimeout(1000);

          // LogManager.addNavigation(this.oldPageName, (this as any).pageName);
          // this.oldPageName = (this as any).pageName;

          const endTime = performance.now();
          this.timeTaken = endTime - (this as any).startTime;
          LogManager.log(`Time taken: ${this.timeTaken.toFixed(2)} ms`, this.state, false);
          return State.OBSERVE;
        }

        default:
          return State.DONE;
      }
    } catch (error) {
      this.bus.emit({ ts: Date.now(), type: "error", message: String(error), stack: (error as Error).stack });
      LogManager.error(`Agent error: ${error}`, this.state);
      return State.DONE;
    }
  }
}
