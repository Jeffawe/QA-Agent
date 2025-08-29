import { Action } from "../../types.js";
import { EventBus } from "../events/event.js";

export class ActionSpamValidator {
  // keep last N actions per agent
  private history: Action[] = [];
  private lastSpamKey: string | null = null;
  private extraSpamCount = 0;

  constructor(private bus: EventBus, private sessionId: string, private windowSize: number = 3, private extraSpamLimit: number = 2) {
    bus.on("action_started", evt => this.onAction(evt.action));
  }

  private onAction(action: Action) {
    this.history.push(action);
    if (this.history.length > this.windowSize) this.history.shift();

    if (this.isSpam()) {
      const spamKey = this.key(this.history[0]);

      if (this.lastSpamKey === spamKey) {
        // Same spam again
        this.extraSpamCount++;
        if (this.extraSpamCount >= this.extraSpamLimit) {
          this.bus.emit({
            ts: Date.now(),
            type: "stop",
            message: `Validator stops because Action "${action.step}" was spammed ${this.windowSize + this.extraSpamCount}× consecutively.`,
            sessionId: this.sessionId
          });

          // reset tracking
          this.reset();
          return;
        }
      } else {
        // First time we see this spam pattern
        this.lastSpamKey = spamKey;
        this.extraSpamCount = 0;

        this.bus.emit({
          ts: Date.now(),
          type: "validator_warning",
          message: `Validator warns that Action "${action.step}" with args "${JSON.stringify(
            action.args
          )}" was repeated ${this.windowSize}× consecutively. Don't pick it again as it obviously doesn't do anything`
        });
      }

      // optional: clear history so warning logic doesn't re-fire instantly
      this.history.length = 0;
    }
  }

  private isSpam(): boolean {
    if (this.history.length < this.windowSize) return false;
    const first = this.history[0];
    return this.history.every(
      a =>
        a.step === first.step &&
        JSON.stringify(a.args) === JSON.stringify(first.args)
    );
  }

  private key(action: Action): string {
    return `${action.step}:${JSON.stringify(action.args)}`;
  }

  private reset() {
    this.history.length = 0;
    this.lastSpamKey = null;
    this.extraSpamCount = 0;
  }
}
