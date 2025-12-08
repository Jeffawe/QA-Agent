import { setTimeout } from "node:timers/promises";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { LinkInfo, State, ImageData, Action, ActionResult, AnalyzerStatus, } from "../types.js";
import { fileExists } from "../utility/functions.js";
import { pageMemory } from "../services/memory/pageMemory.js";
import { crawlMap } from "../utility/crawlMap.js";
import StagehandSession from "../browserAuto/stagehandSession.js";
import AutoActionService from "../services/actions/autoActionService.js";
import path from "node:path";
import { Page } from "@browserbasehq/stagehand";
import { getBaseImageFolderPath, getRelatedScreenshots } from "../services/imageProcessor.js";

export default class AutoAnalyzer extends Agent {
    public activeLink: LinkInfo | null = null;

    private step = 0;
    private queue: LinkInfo[] = [];
    private goal: string = "";
    private visitedPage: boolean = false;
    private lastAction: string = "";
    private page: Page | null = null;

    private stagehandSession: StagehandSession;
    private localactionService: AutoActionService;
    private imagePath: string = "";
    private screenshots: string[] = [];

    constructor(dependencies: BaseAgentDependencies) {
        super("autoanalyzer", dependencies);
        this.setState(dependencies.dependent ? State.WAIT : State.START);

        this.stagehandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
        this.validatorWarningState = State.OBSERVE;
        this.imagePath = getBaseImageFolderPath(this.sessionId);
    }

    /* ───────── external API ───────── */
    /** Crawler (or any agent) calls this to add links to be tested */
    public enqueue(links: LinkInfo[], visitedPage: boolean = false) {
        this.step = 0;
        this.queue = links;
        this.visitedPage = visitedPage;
        if (this.state === State.DONE || this.state === State.WAIT) {
            this.setState(State.START);
        } else {
            this.logManager.log("AutoAnalyzer is already running or cannot start up", this.buildState(), true);
        }
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`AutoAnalyzer requires stagehandSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`AutoAnalyzer requires stagehandSession, got ${this.session.constructor.name}`);
        }

        this.stagehandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`AutoAnalyzer requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`AutoAnalyzer requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
    }

    /** One FSM transition */
    public async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        if (!this.page) {
            const page = await this.stagehandSession.getPage();
            if (!page) {
                throw new Error("Page not initialized");
            }
            this.page = page;
        }

        if (!this.bus) return

        try {
            switch (this.state) {
                /*────────── READY → RUN ──────────*/
                case State.START:
                    (this as any).startTime = performance.now();
                    if (this.visitedPage) {
                        this.logManager.log("I Have visited page before", this.buildState(), true);
                    }
                    this.goal = "Crawl the given page";
                    this.step = 0;
                    this.analyzerStatus = AnalyzerStatus.PAGE_NOT_SEEN;
                    this.logManager.log(`Start testing ${this.queue.length} links`, this.buildState(), true);
                    if (this.queue.length === 0) {
                        this.setState(State.DONE);
                    } else {
                        this.setState(State.OBSERVE);
                    }
                    break;

                case State.OBSERVE: {
                    this.currentUrl = await this.stagehandSession.waitForStableUrl();
                    const filename = `screenshot_${this.step}_${this.sessionId.substring(0, 10)}.png`;
                    const expectedPath = path.resolve(this.imagePath, filename); // Use absolute path

                    if (!(await fileExists(expectedPath))) {
                        this.logManager.log(`Take screenshot ${filename}`, this.buildState(), false);
                        const paths = await this.stagehandSession.takeMultiDeviceScreenshots(this.imagePath, filename);
                        if (!paths || paths.length === 0) {
                            this.logManager.error("Screenshot failed", this.state);
                            this.setState(State.ERROR);
                            this.stopSystem("Screenshot failed");
                            break;
                        }
                        this.screenshots = paths; // Use the actual returned path
                    } else {
                        const allPaths = await getRelatedScreenshots(this.sessionId, this.step, this.imagePath);
                        this.screenshots = allPaths;
                    }

                    this.bus.emit({ ts: Date.now(), type: "screenshot_taken", filename: this.screenshots[0], elapsedMs: 0 });

                    this.setState(State.DECIDE);
                    break;
                }

                case State.DECIDE: {
                    const labels = this.queue.map((link) => link.description);
                    this.logManager.log(`Remaining links: ${labels.length} are: ${JSON.stringify(labels)}`, this.buildState(), false);
                    const nextActionContext = {
                        goal: this.goal,
                        vision: "",
                        lastAction: this.lastAction || null,
                        visitedPages: Array.from(pageMemory.getVisitedLinks()),
                        currentUrl: this.currentUrl,
                        memory: [],
                        possibleLabels: labels,
                    };

                    const imageData: ImageData = {
                        imagepath: this.screenshots,
                    };

                    this.logManager.addMission(nextActionContext.goal);

                    const command = await this.thinker.think(
                        nextActionContext,
                        imageData,
                        this.response,
                        this.name,
                        this.visitedPage
                    );
                    if (!command?.action) {
                        this.logManager.error("Thinker produced no action", this.state, false);
                        this.setState(State.ERROR);
                        break;
                    }

                    if (command.noErrors) {
                        this.analyzerStatus = AnalyzerStatus.SUCCESS_CLICKED;
                    } else {
                        this.analyzerStatus = AnalyzerStatus.ERROR_INVALID;
                    }

                    if (command.analysis) {
                        this.logManager.log(`Storing analysis for ${this.currentUrl}`, this.state, false);
                        pageMemory.addAnalysis(this.currentUrl, command.analysis, this.sessionId);
                    } else {
                        this.logManager.log(`No analysis returned for ${this.currentUrl}`, this.state, false);
                    }

                    (this as any).pendingAction = command.action;

                    this.setState(State.ACT);
                    break;
                }

                case State.ACT: {
                    const action: Action = (this as any).pendingAction;
                    const t0 = Date.now();
                    this.bus.emit({ ts: t0, type: "action_started", action, agentName: this.name });

                    if (action.step === 'error') {
                        this.setState(State.ERROR);
                        break;
                    }

                    // It's done with the page
                    if (action.step === 'done') {
                        this.setState(State.DONE);
                        crawlMap.recordPage(pageMemory.getPage(this.currentUrl), this.sessionId);
                        this.logManager.log("All links have been tested", this.buildState(), true);
                        this.activeLink = null;
                        const endTime = performance.now();
                        this.timeTaken = endTime - (this as any).startTime;

                        // Does this to inform the crawler that it finished it's job and can move on
                        this.analyzerStatus = AnalyzerStatus.SUCCESS_CLICKED;

                        this.logManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                        break;
                    }

                    // It's done with the entire page
                    if (action.step === 'all_done') {
                        this.setState(State.DONE);
                        this.queue = [];
                        this.logManager.log("All links have been tested", this.buildState(), true);
                        this.activeLink = null;
                        pageMemory.setAllLinksVisited(this.currentUrl);
                        const endTime = performance.now();
                        this.timeTaken = endTime - (this as any).startTime;

                        // Does this to inform the crawler that it finished it's job and can move on
                        this.analyzerStatus = AnalyzerStatus.SUCCESS_NO_MORE;

                        this.logManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                        break;
                    }

                    let result: ActionResult | null = null

                    const selectedLink = this.findMatchingLink(action);

                    if (!selectedLink) {
                        const warning = "Validator warns that Action provided is not among the valid list. Please set step to a valid possible action from the list given or click done or all_done if you want to end the mission.";
                        this.bus.emit({
                            ts: Date.now(),
                            type: "validator_warning",
                            message: warning,
                            agentName: this.name
                        });
                        break
                    } else {
                        this.logManager.log(`Selected link is ${selectedLink?.href || selectedLink?.description} with selector ${selectedLink?.selector}`, this.buildState(), false);
                    }

                    try {
                        result = await this.localactionService.executeAction(action, selectedLink, this.buildState());
                    } catch (error) {
                        this.logManager.error(String(error), this.state, false);
                        this.bus.emit({ ts: Date.now(), type: "error", message: String(error), error: (error as Error) });
                        this.setState(State.ERROR);
                        break;
                    }

                    if (!result.success) {
                        this.logManager.error(`Action failed: ${result.actionTaken}`, this.buildState());
                        const warning = `Validator warns that Action could not be performed because of: ${result.actionTaken}. Return error in action.step if no way forward.`;
                        this.bus.emit({
                            ts: Date.now(),
                            type: "validator_warning",
                            message: warning,
                            agentName: this.name
                        });
                        break;
                    }

                    if (this.currentUrl && result.linkType == "external") {
                        this.bus.emit({ ts: Date.now(), type: "new_page_visited", oldPage: this.baseUrl!, newPage: this.stagehandSession.getCurrentUrl(), page: this.page, linkIdentifier: selectedLink.href || selectedLink.description, handled: true });
                    }

                    this.lastAction = `Action ${result.actionTaken || 'no_op'} with args (${action.args.join(",")}) was last taken because of ${action.reason}`;


                    this.bus.emit({ ts: Date.now(), type: "action_finished", action, agentName: this.name, elapsedMs: Date.now() - t0 });
                    const newGoal = action.newGoal || this.goal;
                    if (newGoal != this.goal) {
                        this.logManager.addSubMission(newGoal);
                        this.logManager.addSubMission(this.goal, "done");
                        this.logManager.log(`New Goal set as ${newGoal}`, this.buildState(), false);
                    }

                    this.goal = newGoal;
                    this.step++;
                    await setTimeout(1000);

                    const endTime = performance.now();
                    this.timeTaken = endTime - (this as any).startTime;

                    this.activeLink = selectedLink;

                    this.logManager.log(`Next link to test: ${JSON.stringify(this.activeLink)}`, this.buildState(), false);

                    this.setState(State.DONE);

                    this.logManager.log(`${this.name} agent finished in: ${this.timeTaken.toFixed(2)} ms`, this.buildState(), false);
                    break;
                }

                case State.PAUSE:
                case State.WAIT:
                case State.DONE:
                case State.ERROR:
                default:
                    // nothing to do; top-level loop will skip us
                    break;
            }
        } catch (error) {
            this.logManager.error(String(error), this.buildState(), false);
            this.setState(State.ERROR);
        }
    }

    async cleanup(): Promise<void> {
        this.activeLink = null;
        this.queue = [];
        this.step = 0;
        this.goal = "Crawl the given page";
        this.lastAction = "";
        this.visitedPage = false;
        this.analyzerStatus = AnalyzerStatus.PAGE_NOT_SEEN;
        this.response = "";
    }

    checkifLabelValid(label: string): boolean {
        if (!label) return false;
        return this.queue.map((link) => link.description).includes(label);
    }

    private findMatchingLink(action: Action): LinkInfo | null {
        const candidates = [
            action.step,
            action.possibleActionSelected,
            ...(action.args || [])
        ].filter(Boolean);

        for (const candidate of candidates) {
            // 1. Exact match
            const exactMatch = this.queue.find(link =>
                link.description === candidate ||
                link.selector === candidate ||
                link.href === candidate
            );
            if (exactMatch) return exactMatch;

            // 2. Partial match (very fast)
            const partialMatch = this.queue.find(link => {
                const normalizedCandidate = this.normalize(candidate);
                const normalizedDesc = this.normalize(link.description);
                const normalizedHref = this.normalize(link.href || '');

                return normalizedDesc.includes(normalizedCandidate) ||
                    normalizedCandidate.includes(normalizedDesc) ||
                    normalizedHref.includes(normalizedCandidate);
            });
            if (partialMatch) return partialMatch;

            // 3. Fuzzy match using Levenshtein distance (still fast, ~1ms)
            const fuzzyMatch = this.queue
                .map(link => ({
                    link,
                    score: this.similarity(this.normalize(candidate), this.normalize(link.description))
                }))
                .filter(({ score }) => score > 0.8)
                .sort((a, b) => b.score - a.score)[0];

            if (fuzzyMatch) return fuzzyMatch.link;
        }

        return null;
    }

    private normalize(str: string): string {
        return str.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
    }

    // Levenshtein-based similarity (very fast, no ML needed)
    private similarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    private levenshteinDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }
}

