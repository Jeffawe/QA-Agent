import { Agent, BaseAgentDependencies } from "./utility/abstract.js";

export interface Action {
    step: 'move_mouse_to' | 'click' | 'press_key' | 'wait' | 'no_op' | 'done' | string;
    args: any[];
    reason: string;
    progressDescription?: string;
    newGoal?: string;
    nextLink?: string;
    hasAchievedGoal?: boolean;
    confidence?: number; // Confidence level of the action
}

export interface Bug {
    description: string;
    selector: string;
    severity: 'high' | 'medium' | 'low';
}

export interface Analysis {
    bugs: Bug[];
    ui_issues: Bug[];
    notes: string;
}

export interface TestResult {
    success: boolean;
    issues: string[];
}

export interface ActionResult {
    success: boolean;
    message: string;
}

export interface ThinkResult {
    action: Action;
    analysis?: Analysis;
    pageDetails?: LLMPageResult;
    testResult?: TestResult
    noErrors?: boolean; // Indicates if the action was performed without errors
}

export interface GetNextActionContext {
    goal: string;
    lastAction: string | null;
    memory: string[];
    possibleLabels: any[];
    mainGoal?: string; // Optional main goal for the agent
}

export interface ImageData {
    imagepath: string;
    imageUrl?: string;
}

interface LLMPageResult {
    pageName?: string;
    description?: string;
}

export interface ExtractorOptions {
    pooling: "mean" | "cls" | "none";
    normalize: boolean;
}

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
    color_fingerprint?: {
        avg_color_bgr: [number, number, number];
    };
    text?: string;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export enum ClicKType {
    PAGE = 'page',
    FRAME = 'frame',
    BOTH = 'both'
}

/**
 * Finite‑state machine representing the agent lifecycle.
 */
export enum State {
    START = "START",
    OBSERVE = "OBSERVE",
    DECIDE = "DECIDE",
    ACT = "ACT",
    DONE = "DONE",
    ERROR = "ERROR",
    NOTFOUND = "NOTFOUND",
    VISIT = "VISIT",
    EVALUATE = "EVALUATE",
    WAIT = "WAIT",
    INFO = "INFO",
    VALIDATE = "VALIDATE",
    PLAN = "PLAN",
    PAUSE = "PAUSE",
    RESUME = "RESUME",
    WARN = "WARN"
}

type StateValue = `${State}`;
export type Namespaces = "crawler" | "autocrawler" | "tester" | "autoanalyzer" | "analyzer" | "goalagent" | "planneragent" | "manualanalyzer"; // add more if needed

export type NamespacedState = `${Namespaces}.${StateValue}`;

export interface InteractiveElement {
    id: string;
    selector: string;
    tagName: string;
    label: string;
    rect: Rect;
    attributes: {
        id: string;
        className: string;
        href: string;
        type: string;
        role: string;
        'aria-label': string;
        'data-testid': string;
    };
    isVisible: boolean;
}

export interface PageDetails {
    title: string;
    url?: string;
    uniqueID: string;
    screenshot?: string;
    analysis?: Analysis;
    description: string;
    visited: boolean;
    links: LinkInfo[];
}

export interface LinkInfo {
    description: string;
    selector: string;
    method: string;
    href?: string;
    arguments?: any[];
    visited: boolean;
}

export interface StageHandObserveResult {
    description: string;
    method?: string;
    arguments?: string[];
    selector: string;
}

export interface AgentConfig<T extends BaseAgentDependencies = BaseAgentDependencies> {
    name: Namespaces;
    agentClass: new (dependencies: T) => Agent;
    sessionType: 'puppeteer' | 'playwright' | 'selenium' | 'stagehand' | 'custom';
    actionServiceType?: 'manual' | 'auto';
    dependent?: boolean; // If true, agent won't start until another agent triggers it
    dependencies?: Partial<T>; // Additional/override dependencies
    agentDependencies?: Namespaces[]; // Names of other agents this agent depends on
}

export interface MiniAgentConfig<T extends BaseAgentDependencies = BaseAgentDependencies> {
    name: Namespaces;
    sessionType: 'puppeteer' | 'playwright' | 'selenium' | 'stagehand' | 'custom';
    actionServiceType?: 'manual' | 'auto';
    dependent?: boolean; // If true, agent won't start until another agent triggers it
    dependencies?: Partial<T>; // Additional/override dependencies
    agentDependencies?: Namespaces[]; // Names of other agents this agent depends on
}