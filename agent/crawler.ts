import { Agent } from "../utility/abstract";
import { LogManager } from "../utility/logManager";
import Session from "../models/session";
import { StaticMemory } from "../services/memory/staticMemory";
import { getInteractiveElements } from "../services/UIElementDetector";
import { InteractiveElement, LinkInfo, State } from "../types";
import { EventBus } from "../services/events/event";
import Tester from "./tester";
import { CrawlMap } from "../utility/crawlMap";

export class Crawler extends Agent {
    currentUrl: string | null = null;
    public baseUrl: string | null = null;

    constructor(
        private session: Session,
        private tester: Tester,
        eventBus: EventBus
    ) {
        super("Crawler", eventBus);
    }

    setBaseUrl(url: string) {
        this.baseUrl = url;
        this.currentUrl = url;
    }

    async tick(): Promise<void> {
        const page = this.session.page;
        if (!page) {
            LogManager.error("Page not initialized", this.buildState());
            this.setState(State.ERROR);
            return;
        }
        if (!this.baseUrl) {
            LogManager.error("BaseURL not found", this.buildState());
            this.setState(State.ERROR);
            return;
        }
        if (!this.bus) return;

        if (!this.currentUrl) {
            this.setState(State.ERROR);
            return;
        }

        try {
            switch (this.state) {

                /*────────── 1. START → EVALUATE ──────────*/
                case State.START: {
                    (this as any).startTime = performance.now();
                    this.currentUrl = page.url();
                    if (!StaticMemory.pageExists(this.currentUrl)) {
                        const elements = await getInteractiveElements(this.session.page!);
                        const links = this.convertInteractiveElementsToLinks(elements, this.baseUrl!);
                        LogManager.log(`Links detected: ${links.length} are: ${JSON.stringify(links)}`, this.buildState(), false);
                        const pageDetails = {
                            title: this.currentUrl,
                            url: this.currentUrl,
                            uniqueID: this.currentUrl,
                            description: '',
                            visited: false,
                        };
                        StaticMemory.addPage2(pageDetails, links);
                        CrawlMap.markVisited(this.currentUrl);
                    }
                    this.setState(State.EVALUATE);
                    break;
                }

                /*────────── 2. EVALUATE → VISIT ─────────*/
                case State.EVALUATE: {
                    if (StaticMemory.isFullyExplored(this.currentUrl)) {
                        const back = StaticMemory.popFromStack();
                        if (back) await page.goto(back, { waitUntil: "networkidle0" });
                        else this.setState(State.DONE);
                    } else {
                        this.setState(State.VISIT);
                    }
                    break;
                }

                /*────────── 3. VISIT → ACT ─────────────*/
                case State.VISIT: {
                    let isVisited = true;
                    const unvisited = StaticMemory.getAllUnvisitedLinks(this.currentUrl);
                    LogManager.log(`Visiting ${unvisited.length} unvisited links: ${JSON.stringify(unvisited)}`, this.buildState(), false);
                    if (!StaticMemory.isPageVisited(this.currentUrl)) {
                        for (const l of unvisited) CrawlMap.addEdge(this.currentUrl!, l.href);
                        StaticMemory.markPageVisited(this.currentUrl);
                        isVisited = false;
                    }
                    this.tester.enqueue(unvisited, isVisited);
                    this.setState(State.WAIT);
                    break;
                }

                case State.WAIT: {
                    LogManager.log("Waiting for tester to finish", this.buildState(), false);
                    if (this.tester.isDone()) {
                        LogManager.log("Tester finished", this.buildState(), false);
                        this.setState(State.ACT);
                    }
                    break;
                }

                /*────────── 4. ACT → (START | DONE) ─*/
                case State.ACT: {
                    const next = this.tester.nextLink;
                    if (next) {
                        StaticMemory.markLinkVisited(this.currentUrl, next.text || next.href);
                        StaticMemory.pushToStack(this.currentUrl);
                        CrawlMap.addEdge(this.currentUrl!, next.href);
                        this.setState(State.START);
                    } else {
                        // dead-end → backtrack
                        LogManager.log("Backtracking. No more links", this.buildState(), false);
                        const back = StaticMemory.popFromStack();
                        if (back) {
                            LogManager.log(`Backtracking to ${back}`, this.buildState(), false);
                            await page.goto(back, { waitUntil: "networkidle0" });
                            this.setState(State.START);
                        } else {
                            this.setState(State.DONE);
                        }
                    }

                    const endTime = performance.now();
                    this.timeTaken = endTime - (this as any).startTime;
                    LogManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                    break;
                }

                case State.DONE:   /* fallthrough */
                case State.ERROR:  /* fallthrough */
                default:
                    break;
            }
        } catch (err) {
            LogManager.error(`Crawler error on ${this.currentUrl}: ${err}`, this.buildState());
            this.setState(State.ERROR);
            this.bus.emit({ ts: Date.now(), type: "error", message: String(err), stack: (err as Error).stack });
        }
    }

    convertInteractiveElementsToLinks(
        elements: InteractiveElement[],
        baseURL: string
    ): LinkInfo[] {
        const links: LinkInfo[] = [];

        for (const element of elements) {
            const href = element.attributes.href;
            let include = true;

            if (href) {
                const isInternal =
                    href.startsWith(baseURL) ||
                    href.startsWith("/") ||
                    (!href.startsWith("http") && !href.startsWith("https"));

                if (!isInternal) {
                    include = false;
                }
            }

            if (include) {
                links.push({
                    text:
                        element.label ||
                        element.attributes["aria-label"] ||
                        element.attributes["data-testid"] ||
                        "",
                    selector: element.selector,
                    href: href || "", // fallback to empty string if not present
                    visited: false,
                });
            }
        }

        return links;
    }

    async cleanup(): Promise<void> {

    }
}

