export interface Action {
    step: 'move_mouse_to' | 'click' | 'press_key' | 'wait' | 'no_op' | string;
    args: any[];
    reason: string;
    response?: string;
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
}

export interface GetNextActionContext {
    goal: string;
    vision: string;
    lastAction: string | null;
    memory: string[];
    boxData: Box[];
}

export interface ImageData {
    imagepath: string;
    imageUrl?: string;
}

export interface ThinkResult {
    action: Action;
    confidence?: number;
    memoryPatch?: string;
    notes?: string;
    pageName?: string;
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
  NOTFOUND = "NOTFOUND"
}

export interface ElementData {
    index: number;
    selector: string;
    tagName: string;
    rect: Rect;
    label?: string;
    text: string;
    isClickable: boolean;
    attributes: {
        id: string;
        className: string;
        'aria-label': string;
        'data-testid': string;
        href: string;
        type: string;
    };
}