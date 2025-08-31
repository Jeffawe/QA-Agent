import { setTimeout } from 'node:timers/promises';
import { Action, ActionResult, LinkInfo, NamespacedState, Rect, State } from '../../types.js';
import StagehandSession from '../../browserAuto/stagehandSession.js';
import { ActionService } from '../../utility/abstract.js';

const defaultOffset: Rect = { x: 0, y: 0, width: 0, height: 0 };

export default class AutoActionService extends ActionService {
    private localsession: StagehandSession;

    constructor(session: StagehandSession) {
        super(session);
        this.localsession = session as StagehandSession;
    }

    async executeAction(action: Action, data: LinkInfo, state: State | NamespacedState = State.ACT, offset: Rect = defaultOffset): Promise<ActionResult> {
        this.intOrext = "external";
        try {
            if (action.step === "wait") {
                this.logManager.log("Waiting for a while before next action", state);
                await this.wait(action.args[0] || 5000);
            }else{
                this.localsession.act(action.step);
                this.logManager.log(`Executing action: ${action.step}`, state);
            }
            
            this.logManager.log(`Action result: ${this.intOrext}`, state);

            return { success: true, message: this.intOrext };
        } catch (error) {
            throw error;
        }
    }

    async wait(ms: number): Promise<void> {
        await setTimeout(ms);
    }

    async isExternalByLink(
        elements: LinkInfo,
        baseURL: string
    ): Promise<boolean> {
        try {
            if(this.localsession.page === null){
                throw new Error("Page is null");
            }

            // Store current URL
            const currentURL = this.localsession.page.url();

            // Get the link's href attribute
            const linkHref = await this.localsession.page.getAttribute(elements.selector, 'href');

            if (!linkHref) {
                return false; // No href means it's likely not a navigation link
            }

            // Check if it's obviously external without navigation
            if (linkHref.startsWith('http://') || linkHref.startsWith('https://')) {
                const linkURL = new URL(linkHref);
                const baseURLObj = new URL(baseURL);
                return linkURL.hostname !== baseURLObj.hostname;
            }

            // For relative links or unclear cases, actually test navigation
            await this.localsession.page.click(elements.selector);

            // Wait a bit for navigation to potentially occur
            await this.localsession.page.waitForTimeout(1000);

            const newURL = this.localsession.page.url();
            const isExternal = newURL !== currentURL && !newURL.startsWith(baseURL);

            // Navigate back to original page
            await this.localsession.page.goto(currentURL);

            return isExternal;

        } catch (error) {
            console.error('Error checking if link is external:', error);
            // If we can't determine, assume it's internal to be safe
            return false;
        }
    }
}
