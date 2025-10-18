import { Page } from "playwright";
import { EventBus } from "../events/event.js";
import { PageMemory } from "../memory/pageMemory.js";
import { LogManager } from "../../utility/logManager.js";
import { logManagers } from "../memory/logMemory.js";
import { State } from "../../types.js";
import { isSameOriginWithPath } from "../../utility/functions.js";

export class NewPageValidator {
    private logManager: LogManager | null = null;

    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("new_page_visited", evt => this.onAction(evt.newPage, evt.oldPage, evt.page, evt.linkIdentifier, evt.handled));
        this.logManager = logManagers.getOrCreateManager(sessionId);
    }

    private async onAction(newPage: string, oldPage?: string, page?: Page, linkIdentifier?: string, handled?: boolean) {
        if (!oldPage || !newPage) return;

        const isSameOrigin = isSameOriginWithPath(oldPage, newPage);

        this.logManager?.log(`NewPageValidator: oldPage="${oldPage}", newPage="${newPage}", isSameOrigin=${isSameOrigin}`, State.INFO, true);

        if (!isSameOrigin) {
            if (linkIdentifier) {
                PageMemory.markLinkVisited(oldPage, linkIdentifier);
            }

            if (handled) {
                this.logManager?.log(`Navigation to external page detected: "${newPage}" from "${oldPage}". It is handled so ignoring.`, State.INFO, true);
                return;
            }

            this.bus.emit({
                ts: Date.now(),
                type: "validator_warning",
                message: `Navigation to external page detected: "${newPage}" from "${oldPage}". Going back.`
            });

            // Optional: ensure page is defined before going back
            try {
                await page?.goto(oldPage, ({ waitUntil: "networkidle" }));
            } catch (err) {
                this.bus.emit({
                    ts: Date.now(),
                    type: "error",
                    message: `Failed to goBack() after external page nav: ${err instanceof Error ? err.message : String(err)}`,
                    error: err instanceof Error ? err : undefined
                });
            }
        }
    }
}
