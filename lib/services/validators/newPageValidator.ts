import { Page } from "puppeteer";
import Session from "../../models/session.js";
import { EventBus } from "../events/event.js";

export class NewPageValidator {
    constructor(private bus: EventBus, private session: Session) {
        bus.on("new_page_visited", evt => this.onAction(evt.newPage, evt.oldPage, evt.page));
    }

    private async onAction(newPage: string, oldPage?: string, page?: Page) {
        if (!oldPage || !newPage) return;

        const oldUrl = new URL(oldPage);
        const newUrl = new URL(newPage);

        const isSameOrigin =
            oldUrl.protocol === newUrl.protocol &&
            oldUrl.hostname === newUrl.hostname;

        if (!isSameOrigin) {
            this.bus.emit({
                ts: Date.now(),
                type: "validator_warning",
                message: `Navigation to external page detected: "${newPage}" from "${oldPage}". Going back.`
            });

            // Optional: ensure page is defined before going back
            try {
                await page?.goBack({ waitUntil: "networkidle0" });
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
