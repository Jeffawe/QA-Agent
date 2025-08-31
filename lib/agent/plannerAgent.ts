import { State } from "../types.js";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { GoalAgent } from "./goalIntelliAgent.js";
import { pipeline } from '@xenova/transformers';
import StagehandSession from "../browserAuto/stagehandSession.js";
import { ExtractorOptions } from "../types.js";
import AutoActionService from "../services/actions/stagehandActionService.js";

interface ClassificationResult {
    label: string;
    score: number;
}

interface ValidationMetrics {
    progressSimilarity: number;
    intentClassification: number;
    overallScore: number;
}

export default class PlannerAgent extends Agent {
    private mainGoal: string;
    private warning: string = "";
    private extractor: any = null;
    private classifier: any = null;
    private lastProgress: number = 0;
    private currentProgress: number = 0;
    private validationHistory: ValidationMetrics[] = [];
    private goalAgent: GoalAgent;
    private goal: string = "";

    private stageHandSession: StagehandSession;
    private localactionService: AutoActionService;

    // Thresholds for different validation measures
    private readonly PROGRESS_THRESHOLD = 0.80;
    private readonly SEMANTIC_THRESHOLD = 0.80;
    private readonly INTENT_THRESHOLD = 0.70;
    private readonly OVERALL_THRESHOLD = 0.70;

    constructor(dependencies: BaseAgentDependencies) {
        super("planneragent", dependencies);
        this.mainGoal = "";
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.goalAgent = this.requireAgent<GoalAgent>("goalagent");

        this.load();

        this.stageHandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`PlannerAgent requires PuppeteerSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`PlannerAgent requires PuppeteerSession, got ${this.session.constructor.name}`);
        }

        this.stageHandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`PlannerAgent requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`PlannerAgent requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
    }

    async load(): Promise<void> {
        // Initialize the feature extraction pipeline for similarity
        this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

        // Initialize text classification for intent recognition
        this.classifier = await pipeline('text-classification', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        this.baseUrl = url;
        this.currentUrl = url;
        this.mainGoal = mainGoal || "";
    }

    async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        try {
            switch (this.state) {
                case State.START:
                    this.setState(State.PLAN);
                    this.goal = this.mainGoal;
                    this.logManager.addMission(this.mainGoal)
                    break;

                case State.PLAN:
                    this.setState(State.ACT);
                    break;

                case State.ACT:
                    this.goalAgent.run(this.goal, this.warning);
                    this.setState(State.WAIT);
                    break;

                case State.WAIT:
                    this.logManager.log(`PlannerAgent waiting for Goal Agent`, this.buildState(), true);
                    if (this.goalAgent.isDone()) {
                        if (!this.goalAgent.noErrors) {
                            this.logManager.error("Goal Agent did not see the page, cannot proceed", this.buildState(), true);
                            this.setState(State.PLAN);
                        } else {
                            this.setState(State.VALIDATE);
                        }
                    }
                    break;

                case State.VALIDATE:
                    await this.validateGoal();
                    break;

                case State.DECIDE:
                    this.setState(State.PLAN);
                    break;

                case State.PAUSE:
                case State.ERROR:
                case State.DONE:
                default:
                    break;
            }
        }
        catch (e) {
            this.logManager.error(String(e), this.buildState());
            this.setState(State.ERROR);
        }
    }

    async cleanup(): Promise<void> {
        this.extractor = null;
        this.classifier = null;
        this.validationHistory = [];
        this.mainGoal = "";
        this.warning = "";
        this.lastProgress = 0;
        this.currentProgress = 0;
    }

    private async validateGoal(): Promise<boolean> {
        try {
            // Get actual current state from session/browser
            const currentPageState = await this.getCurrentPageState();
            const goalProgress = this.goalAgent.progressDescription;

            if (!goalProgress) {
                this.logManager.error("Goal progress description is empty.", this.buildState(), true);
                this.setState(State.ERROR);
                return false;
            }

            const metrics = await this.calculateValidationMetrics(
                this.mainGoal,
                goalProgress,
                currentPageState
            );

            this.validationHistory.push(metrics);
            this.currentProgress = metrics.overallScore;

            this.logManager.log(`Validation Metrics: ${JSON.stringify(metrics)}`, this.buildState(), true);

            // Check if goal is fully achieved
            if (this.isGoalFullyAchieved(metrics)) {
                this.setState(State.DONE);
                return true;
            }

            // Check if progress is being made
            if (this.isProgressImproving(metrics)) {
                this.setState(State.DECIDE);
                this.lastProgress = this.currentProgress;
                this.warning = "";
                this.goal = this.goalAgent.goal;
                this.logManager.addSubMission(this.goal);
                return true;
            } else {
                this.setState(State.PLAN);
                this.goalAgent.reset();
                this.warning = this.generateWarningMessage(metrics);
                this.lastProgress = this.currentProgress;
                return false;
            }
        } catch (error) {
            this.logManager.error(`Error validating goal: ${error}`, this.buildState(), true);
            this.setState(State.ERROR);
            return false;
        }
    }

    private async calculateValidationMetrics(
        goal: string,
        progress: string,
        pageState: string
    ): Promise<ValidationMetrics> {
        const options: ExtractorOptions = { pooling: 'mean', normalize: true };

        // 1. Progress Similarity - How similar is current progress to the goal
        const [goalVec, progressVec] = await Promise.all([
            this.extractor(goal, options),
            this.extractor(progress, options)
        ]);
        const progressSimilarity = this.cosineSimilarity(goalVec.data, progressVec.data);

        // 2. Intent Classification - Is the intent of completion achieved?
        const intentClassification = await this.classifyGoalIntent(goal, progress, pageState);

        // Calculate overall score (weighted average)
        const overallScore = (
            progressSimilarity * 0.4 +
            intentClassification * 0.2
        );

        return {
            progressSimilarity,
            intentClassification,
            overallScore
        };
    }

    private async classifyGoalIntent(
        goal: string,
        progress: string,
        pageState: string
    ): Promise<number> {
        // Create a completion statement to classify
        const completionStatement = `Goal: ${goal}. Current state: ${pageState}. Progress: ${progress}. This goal has been completed successfully.`;

        try {
            const result: ClassificationResult[] = await this.classifier(completionStatement);

            // Assuming the classifier returns positive/negative sentiment
            // Positive sentiment indicates goal completion confidence
            const positiveScore = result.find(r => r.label === 'POSITIVE')?.score || 0;

            return positiveScore;
        } catch (error) {
            this.logManager.error(`Intent classification error: ${error}`, this.buildState());
            return 0.5;
        }
    }

    private async getCurrentPageState(): Promise<string> {
        try {
            // Get current page information from session
            const pageInfo = await this.stageHandSession.getCurrentPageInfo();
            return `Page title: ${pageInfo.title}. Current URL: ${pageInfo.url}. Page content summary: ${pageInfo.contentSummary}`;
        } catch (error) {
            this.logManager.error(`Error getting page state: ${error}`, this.buildState());
            return "Unable to determine current page state";
        }
    }

    private isGoalFullyAchieved(metrics: ValidationMetrics): boolean {
        return (
            this.goalAgent.hasAchievedGoal &&
            metrics.progressSimilarity >= this.PROGRESS_THRESHOLD &&
            metrics.intentClassification >= this.INTENT_THRESHOLD &&
            metrics.overallScore >= this.OVERALL_THRESHOLD
        );
    }

    private isProgressImproving(metrics: ValidationMetrics): boolean {
        if (this.validationHistory.length < 2) {
            return true; // First validation, assume progress
        }

        const previousMetrics = this.validationHistory[this.validationHistory.length - 2];

        // Check if any metric has improved significantly
        return (
            metrics.progressSimilarity > previousMetrics.progressSimilarity + 0.05 ||
            metrics.intentClassification > previousMetrics.intentClassification + 0.05
        );
    }

    private generateWarningMessage(metrics: ValidationMetrics): string {
        const issues: string[] = [];

        if (metrics.progressSimilarity < this.PROGRESS_THRESHOLD) {
            issues.push("progress towards goal is insufficient");
        }

        if (metrics.intentClassification < this.INTENT_THRESHOLD) {
            issues.push("goal completion intent is not clearly achieved");
        }

        if (issues.length === 0) {
            return "Progress has stalled. Review current approach and try a different strategy.";
        }

        return `Issues detected: ${issues.join(", ")}. Please address these concerns and retry.`;
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) {
            throw new Error('Vectors must have the same length');
        }

        return vecA.reduce((acc: number, v: number, i: number) => acc + v * vecB[i], 0);
    }

    // Getter methods for external access
    public getValidationHistory(): ValidationMetrics[] {
        return [...this.validationHistory];
    }

    public getCurrentMetrics(): ValidationMetrics | null {
        return this.validationHistory.length > 0
            ? this.validationHistory[this.validationHistory.length - 1]
            : null;
    }
}
