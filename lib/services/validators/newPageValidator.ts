import { Page } from "playwright";
import { EventBus } from "../events/event.js";
import { PageMemory } from "../memory/pageMemory.js";
import { LogManager } from "../../utility/logManager.js";
import { logManagers } from "../memory/logMemory.js";
import { State } from "../../types.js";

export class NewPageValidator {
    private logManager: LogManager | null = null;

    constructor(private bus: EventBus, private sessionId: string) {
        bus.on("new_page_visited", evt => this.onAction(evt.newPage, evt.oldPage, evt.page, evt.linkIdentifier));
        this.logManager = logManagers.getOrCreateManager(sessionId);
    }

    private async onAction(newPage: string, oldPage?: string, page?: Page, linkIdentifier?: string) {
        if (!oldPage || !newPage) return;

        const oldUrl = new URL(oldPage);
        const newUrl = new URL(newPage);

        const isSameOrigin =
            oldUrl.protocol === newUrl.protocol &&
            oldUrl.hostname === newUrl.hostname;

        this.logManager?.log(`NewPageValidator: oldPage="${oldPage}", newPage="${newPage}", isSameOrigin=${isSameOrigin}`, State.INFO, true);

        if (!isSameOrigin) {
            this.bus.emit({
                ts: Date.now(),
                type: "validator_warning",
                message: `Navigation to external page detected: "${newPage}" from "${oldPage}". Going back.`
            });

            if(linkIdentifier) {
                PageMemory.removeLink(oldPage, linkIdentifier);
            }

            // Optional: ensure page is defined before going back
            try {
                await page?.goBack({ waitUntil: "networkidle" });
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
