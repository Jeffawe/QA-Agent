import { setTimeout } from 'node:timers/promises';
import { Action, ActionResult, ClicKType, InteractiveElement, NamespacedState, Rect, State } from '../../types.js';
import Session from '../../models/session.js';
import { LogManager } from '../../utility/logManager.js';

const defaultOffset: Rect = { x: 0, y: 0, width: 0, height: 0 };

export default class ActionService {
  private session: Session;

  //If the new page that will be clicked is an internal page or external page
  private intOrext: string = '';
  private baseUrl: string = '';

  constructor(session: Session) {
    this.session = session;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  async executeAction(action: Action, elementData: InteractiveElement[], state: State | NamespacedState = State.ACT, offset: Rect = defaultOffset): Promise<ActionResult> {
    this.intOrext = "internal";
    try {
      switch (action.step) {
        case 'move_mouse_to':
          if (typeof action.args[0] === 'number' && typeof action.args[1] === 'number') {
            await this.session.moveMouseTo(action.args[0] + offset.x, action.args[1] + offset.y);
            await this.session.showClickPoint(action.args[0] + offset.x, action.args[1] + offset.y, ClicKType.FRAME);
          } else {
            console.error('Invalid arguments for move_mouse_to:', action.args);
          }
          break;

        case 'click':
          if (typeof action.args[0] === 'string') {
            const isExternal = this.isExternalByLabel(elementData, action.args[0], this.baseUrl!);
            if (isExternal) {
              this.intOrext = "external";
            }
            const selector = this.getSelectorByLabel(elementData, action.args[0]);
            if (!selector) {
              throw new Error(`Selector not found for label: ${action.args[0]}`);
            }
            await this.session.pressSelector(selector);
          } else if (typeof action.args[0] === 'number' && typeof action.args[1] === 'number') {
            await this.session.click(action.args[0] + offset.x, action.args[1] + offset.y);
            await this.session.showClickPoint(action.args[0] + offset.x, action.args[1] + offset.y, ClicKType.FRAME);
          } else {
            console.error('Invalid arguments for click:', action.args);
          }

          break;

        case 'press_key':
          if (typeof action.args[0] === 'string') {
            await this.session.pressKey(action.args[0]);
          } else {
            console.error('Invalid arguments for press_key:', action.args);
          }
          break;

        case 'wait':
          if (typeof action.args[0] === 'number') {
            await this.wait(action.args[0]);
          } else {
            console.error('Invalid arguments for wait:', action.args);
          }
          break;

        case 'no_op':
          this.intOrext = "external";
          break;

        case 'done':
          this.intOrext = "external";
          break;

        default:
          console.error('Unknown action step:', action.step);
          break;
      }

      LogManager.log(`Executed action: ${action.step} with args: ${JSON.stringify(action.args)}`, state, true);
      LogManager.log(`Reason: ${action.reason}`, state, true);

      return { success: true, message: this.intOrext };
    } catch (error) {
      throw error;
    }
  }

  async wait(ms: number): Promise<void> {
    await setTimeout(ms);
  }

  public async clickSelector(selector: string): Promise<void> {
    await this.session.pressSelector(selector);
  }

  getSelectorByLabel = (
    clickableElements: InteractiveElement[],
    label: string
  ): string | null => {
    for (const el of clickableElements) {
      if (
        el.label === label ||
        el.attributes["aria-label"] === label ||
        el.attributes["data-testid"] === label
      ) {
        return el.selector;
      }
    }
    return null;
  };

  isExternalByLabel(
    elements: InteractiveElement[],
    label: string,
    baseURL: string
  ): boolean {
    const match = elements.find(
      el =>
        el.label === label ||
        el.attributes["aria-label"] === label ||
        el.attributes["data-testid"] === label
    );

    if (!match) return false; // can't find it = assume safe

    const href = match.attributes.href?.trim();

    if (!href) return false; // no href = internal (modal, etc.)

    const isExternal =
      href.startsWith("http") || href.startsWith("/") || href.startsWith("./");

    // If it's a full URL but still matches your own base URL, it's internal
    if (href.startsWith(baseURL)) return false;

    return isExternal;
  }

}
