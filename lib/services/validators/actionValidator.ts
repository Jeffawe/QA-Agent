import { Action } from "../../types.js";
import { EventBus } from "../events/event.js";

export class ActionSpamValidator {
  // keep last N actions per agent
  private history: Action[] = [];

  constructor(private bus: EventBus, private windowSize: number = 3) {
    bus.on("action_started", evt => this.onAction(evt.action));
  }

  private onAction(action: Action) {
    this.history.push(action);
    if (this.history.length > this.windowSize)
      this.history.shift();

    if (this.isSpam()) {
      this.bus.emit({
        ts: Date.now(),
        type: "validator_warning",
        message: `Validator warns that Action "${action.step}" with args "${JSON.stringify(action.args)}" was repeated ${this.windowSize}× consecutively. Don't pick it again as it obviosuly doesn't do anything`
      });
      // optional: clear window so we don’t spam the warning itself
      this.history.length = 0;
    }
  }

  private isSpam(): boolean {
    if (this.history.length < this.windowSize) return false;
    const first = this.history[0].step;
    return this.history.every(a => a.step === first);
  }
}
