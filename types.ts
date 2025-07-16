export interface Action {
    step: 'move_mouse_to' | 'click' | 'press_key' | 'wait' | 'no_op' | string;
    args: any[];
    reason: string;
    newGoal?: string;
    nextLink?: string;
}

export interface ActionResult {
    success: boolean;
    message: string;
}

export interface Bug {
    description: string;
    selector: string;
    severity: 'high' | 'medium' | 'low';
}

export interface UIIssue {
    description: string;
    selector: string;
    severity: 'high' | 'medium' | 'low';
}

export interface Analysis {
    bugs: Bug[];
    ui_issues: UIIssue[];
    notes: string;
}

export interface AnalysisResponse {
    analysis: Analysis;
    action: Action;
    pageDetails?: LLMPageResult;
}

export interface GetNextActionContext {
    goal: string;
    vision: string;
    lastAction: string | null;
    memory: string[];
    possibleLabels: string[];
}

export interface ImageData {
    imagepath: string;
    imageUrl?: string;
}

interface LLMPageResult {
    pageName?: string;
    description?: string;
}

export interface ThinkResult {
    action: Action;
    confidence?: number;
    memoryPatch?: string;
    notes?: string;
    pageDetails?: LLMPageResult;
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
    INFO = "INFO"
}

type StateValue = `${State}`;
export type Namespaces = "Crawler" | "Tester"; // add more if needed

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
    description: string;
    visited: boolean;
    links: LinkInfo[];
}

export interface LinkInfo {
  text: string;
  selector: string;
  href: string;
  visited: boolean;
}