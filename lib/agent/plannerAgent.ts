import Session from "../browserAuto/session";
import { EventBus } from "../services/events/event";
import { State } from "../types";
import { Agent } from "../utility/abstract";
import { LogManager } from "../utility/logManager";
import { GoalAgent } from "./goalIntelliAgent";
import { pipeline } from '@xenova/transformers';

interface ExtractorResult {
    data: number[];
}

interface ExtractorOptions {
    pooling: 'mean' | 'cls' | 'max';
    normalize: boolean;
}

interface ClassificationResult {
    label: string;
    score: number;
}

interface ValidationMetrics {
    progressSimilarity: number;
    semanticSimilarity: number;
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

    // Thresholds for different validation measures
    private readonly PROGRESS_THRESHOLD = 0.85;
    private readonly SEMANTIC_THRESHOLD = 0.80;
    private readonly INTENT_THRESHOLD = 0.75;
    private readonly OVERALL_THRESHOLD = 0.80;

    constructor(
        eventBus: EventBus,
        private session: Session,
        private goalAgent: GoalAgent,
        mainGoal: string
    ) {
        super("Planner", eventBus);
        this.mainGoal = mainGoal;
    }

    async load(): Promise<void> {
        // Initialize the feature extraction pipeline for similarity
        this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

        // Initialize text classification for intent recognition
        this.classifier = await pipeline('text-classification', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
    }

    async tick(): Promise<void> {
        try {
            switch (this.state) {
                case State.START:
                    this.setState(State.PLAN);
                    break;

                case State.PLAN:
                    this.setState(State.ACT);
                    break;

                case State.ACT:
                    this.goalAgent.run(this.mainGoal, this.warning);
                    break;

                case State.WAIT:
                    LogManager.log(`PlannerAgent waiting for Goal Agent`, this.buildState(), true);
                    if (this.goalAgent.isDone()) {
                        this.setState(State.VALIDATE);
                    }
                    break;

                case State.VALIDATE:
                    await this.validateGoal();
                    break;

                case State.DECIDE:
                    this.setState(State.PLAN);
                    break;

                case State.ERROR:
                case State.DONE:
                default:
                    break;
            }
        }
        catch (e) {
            LogManager.error(String(e), this.buildState());
            this.setState(State.ERROR);
        }
    }

    async cleanup(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    private async validateGoal(): Promise<boolean> {
        try {
            // Get actual current state from session/browser
            const currentPageState = await this.getCurrentPageState();
            const goalProgress = this.goalAgent.progressDescription;

            if (!goalProgress) {
                LogManager.error("Goal progress description is empty.", this.buildState(), true);
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

            LogManager.log(`Validation Metrics: ${JSON.stringify(metrics)}`, this.buildState(), true);

            // Check if goal is fully achieved
            if (this.isGoalFullyAchieved(metrics)) {
                this.setState(State.DONE);
                return true;
            }

            // Check if progress is being made
            if (this.isProgressImproving(metrics)) {
                this.setState(State.DECIDE);
                this.lastProgress = this.currentProgress;
                return true;
            } else {
                this.setState(State.PLAN);
                this.goalAgent.reset();
                this.warning = this.generateWarningMessage(metrics);
                this.lastProgress = this.currentProgress;
                return false;
            }
        } catch (error) {
            LogManager.error(`Error validating goal: ${error}`, this.buildState(), true);
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

        // 2. Semantic Similarity - How similar is the page state to the goal
        const [goalVec2, pageStateVec] = await Promise.all([
            this.extractor(goal, options),
            this.extractor(pageState, options)
        ]);
        const semanticSimilarity = this.cosineSimilarity(goalVec2.data, pageStateVec.data);

        // 3. Intent Classification - Is the intent of completion achieved?
        const intentClassification = await this.classifyGoalIntent(goal, progress, pageState);

        // Calculate overall score (weighted average)
        const overallScore = (
            progressSimilarity * 0.4 +
            semanticSimilarity * 0.4 +
            intentClassification * 0.2
        );

        return {
            progressSimilarity,
            semanticSimilarity,
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
            LogManager.error(`Intent classification error: ${error}`, this.buildState());
            return 0.5;
        }
    }

    private async getCurrentPageState(): Promise<string> {
        try {
            // Get current page information from session
            const pageInfo = await this.session.getCurrentPageInfo();
            return `Page title: ${pageInfo.title}. Current URL: ${pageInfo.url}. Page content summary: ${pageInfo.contentSummary}`;
        } catch (error) {
            LogManager.error(`Error getting page state: ${error}`, this.buildState());
            return "Unable to determine current page state";
        }
    }

    private isGoalFullyAchieved(metrics: ValidationMetrics): boolean {
        return (
            this.goalAgent.hasAchievedGoal &&
            metrics.progressSimilarity >= this.PROGRESS_THRESHOLD &&
            metrics.semanticSimilarity >= this.SEMANTIC_THRESHOLD &&
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
            metrics.semanticSimilarity > previousMetrics.semanticSimilarity + 0.05 ||
            metrics.intentClassification > previousMetrics.intentClassification + 0.05
        );
    }

    private generateWarningMessage(metrics: ValidationMetrics): string {
        const issues: string[] = [];

        if (metrics.progressSimilarity < this.PROGRESS_THRESHOLD) {
            issues.push("progress towards goal is insufficient");
        }

        if (metrics.semanticSimilarity < this.SEMANTIC_THRESHOLD) {
            issues.push("current page state doesn't match expected goal state");
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
