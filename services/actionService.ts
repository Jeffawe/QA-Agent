import { setTimeout } from 'node:timers/promises';
import { Action, ClicKType, InteractiveElement, Rect } from '../types';
import Session from '../models/session';
import { LogManager } from '../logManager';

const defaultOffset: Rect = { x: 0, y: 0, width: 0, height: 0 };

export default class ActionService {
  private session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  async executeAction(action: Action, elementData: InteractiveElement[], offset: Rect = defaultOffset): Promise<void> {
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
          // Do nothing
          break;

        default:
          console.error('Unknown action step:', action.step);
          break;
      }

      LogManager.log(`Executed action: ${action.step} with args: ${JSON.stringify(action.args)}`);
      LogManager.log(`Reason: ${action.reason}`);
    } catch (error) {
      throw error;
    }
  }

  async wait(ms: number): Promise<void> {
    await setTimeout(ms);
  }

  getSelectorByLabel = (clickableElements: InteractiveElement[], label: string): string | null => {
    const element = clickableElements.find(el => el.label === label);
    return element ? element.selector : null;
  };
}
