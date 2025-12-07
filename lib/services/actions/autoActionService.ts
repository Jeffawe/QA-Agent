import { setTimeout } from 'node:timers/promises';
import { Action, ActionResult, LinkInfo, NamespacedState, Rect, State } from '../../types.js';
import StagehandSession from '../../browserAuto/stagehandSession.js';
import { ActionService } from '../../utility/abstract.js';

export default class AutoActionService extends ActionService {
    private localsession: StagehandSession;

    constructor(session: StagehandSession) {
        super(session);
        this.localsession = session as StagehandSession;
    }

    /**
     * Executes an action based on the given action object.
     * 
     * @param {Action} action - The action to take.
     * @param {LinkInfo} detailedAction - The detailed action to take if the action.step is not one of the valid steps (It is usually the action itself or one of the valid actions closest to the action given).
     * @param {State | NamespacedState} [state=State.ACT] - The current state of the crawl.
     * @returns {Promise<ActionResult>} - The result of the action taken.
     * @throws {Error} - If the action.step is invalid.
     */
    async executeAction(action: Action, detailedAction: LinkInfo, state: State | NamespacedState = State.ACT): Promise<ActionResult> {
        this.intOrext = "external";
        try {
            let finalAction : string = action.step;
            if (action.step === "wait") {
                this.logManager.log("Waiting for a while before next action", state);
                await this.wait(action.args[0] || 5000);
            }else{
                const validSteps = ['move_mouse_to', 'click', 'press_key', 'no_op'] as const;
                if (validSteps.includes(action.step as any)) {
                    if(action.args && action.args.length > 0){
                        finalAction = action.args[0] as string;
                    }else{
                        throw new Error(`Invalid action step: ${action.step}`);
                    }
                }

                const actionToTake = detailedAction.selector ?? finalAction;
                await this.localsession.act(actionToTake);
            }

            return { success: true, linkType: this.intOrext, actionTaken: finalAction };
        } catch (error) {
            throw error;
        }
    }

    async wait(ms: number): Promise<void> {
        await setTimeout(ms);
    }
}
