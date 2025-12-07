import { Agent, BaseAgentDependencies } from "./utility/abstract.js";

export interface Action {
    step: 'move_mouse_to' | 'click' | 'press_key' | 'wait' | 'no_op' | 'done' | string;
    args: any[];
    reason: string;
    progressDescription?: string;
    possibleActionSelected?: string;
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

export interface ActionResult {
    success: boolean;
    linkType: "internal" | "external";
    actionTaken: string;
}

export interface TokenUsage {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
    imageTokens?: number;
}

export interface ThinkResult {
    action: Action;
    analysis?: Analysis;
    pageDetails?: LLMPageResult;
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
    imagepath: string[];
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

export enum AnalyzerStatus {
    SUCCESS_CLICKED,      // Clicked a link, crawler should follow
    SUCCESS_NO_MORE,      // No links worth clicking, crawler should backtrack
    ERROR_BLIND,          // Couldn't see the page, crawler should retry
    ERROR_INVALID,        // LLM gave invalid selector, already retried
    PAGE_NOT_SEEN,        // Analyzer didn't really go through and fell somewhere
}

type StateValue = `${State}`;
export type Namespaces = "crawler" | "autocrawler" | "tester" | "autoanalyzer" | "analyzer" | "goalagent" | "planneragent" | "manualanalyzer" | "manualAutoanalyzer" | `${string}agent`; // add more if needed

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
    url: string;
    parentUrl: string;
    uniqueID: string;
    screenshot?: string;
    analysis?: Analysis;
    testResults?: UITesterResult[];
    endpointResults?: EndPointTestResult[];
    description: string;
    visited: boolean;
    depth: number;
    hasDepth: boolean;
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
    extractedUrl?: string;
}

export interface AgentConfig<T extends BaseAgentDependencies = BaseAgentDependencies> {
    name: Namespaces;
    agentClass: new (dependencies: T) => Agent;
    sessionType: 'puppeteer' | 'playwright' | 'selenium' | 'stagehand' | 'custom';
    actionServiceType?: 'manual' | 'auto';
    thinkerType: 'combined' | 'testing' | 'default';
    dependent?: boolean; // If true, agent won't start until another agent triggers it
    dependencies?: Partial<T>; // Additional/override dependencies
    agentDependencies?: Namespaces[]; // Names of other agents this agent depends on
}

export interface MiniAgentConfig<T extends BaseAgentDependencies = BaseAgentDependencies> {
    name: Namespaces;
    sessionType: 'puppeteer' | 'playwright' | 'selenium' | 'stagehand' | 'custom';
    actionServiceType?: 'manual' | 'auto';
    thinkerType: 'combined' | 'testing' | 'default';
    dependent?: boolean; // If true, agent won't start until another agent triggers it
    dependencies?: Partial<T>; // Additional/override dependencies
    agentDependencies?: Namespaces[]; // Names of other agents this agent depends on
}

export enum UIElementType {
    BUTTON = 'button',
    TEXT_INPUT = 'text_input',
    EMAIL_INPUT = 'email_input',
    PASSWORD_INPUT = 'password_input',
    NUMBER_INPUT = 'number_input',
    DATE_INPUT = 'date_input',
    FILE_INPUT = 'file_input',
    TEXTAREA = 'textarea',
    SELECT = 'select',
    CHECKBOX = 'checkbox',
    RADIO = 'radio',
    RANGE = 'range',
    COLOR = 'color',
    SEARCH = 'search',
    TEL = 'tel',
    URL_INPUT = 'url_input',
    TIME = 'time',
    DATETIME_LOCAL = 'datetime_local',
    WEEK = 'week',
    MONTH = 'month',
    FORM = 'form',
    LINK = 'link',
    IMAGE = 'image',
    VIDEO = 'video',
    AUDIO = 'audio',
    CANVAS = 'canvas',
    IFRAME = 'iframe',
    UNKNOWN = 'unknown'
}

export interface ElementDetails {
    tagName: string;
    inputType?: string;
    role?: string;
    disabled?: boolean;
    required?: boolean;
    placeholder?: string;
    value?: string;
    options?: string[]; // for select elements
    min?: string;
    max?: string;
    pattern?: string;
    accept?: string; // for file inputs
}


export interface UIElementInfo extends StageHandObserveResult {
    elementType: UIElementType;
    elementDetails: ElementDetails;
    testable: boolean;
    extractedAttributes?: Record<string, string | null>;
}

export interface FormElementInfo extends UIElementInfo {
    formElements?: UIElementInfo[];
    formAction?: string;
    formMethod?: string;
}

export interface UITesterResult {
    element: UIElementInfo;
    ledTo?: string;
    testType: 'positive' | 'negative';
    testValue: any;
    success: boolean;
    error?: string;
    response?: string;
}

export interface EndPointTestResult {
    endpoint: string;           // "POST /users/{id}"
    request: {                  // Request details
        method: string;           // HTTP method
        headers: Record<string, string>;
        body?: any;               // Request body (if applicable)
    };
    success: boolean;
    error?: string;            // Error message if failed
    response?: {               // Response if successful
        url: string;             // Full URL
        status: number;          // HTTP status code
        statusText: string;      // HTTP status text
        headers: Record<string, string>;
        data: any;              // Parsed response body (JSON or text)
        responseTime: number;   // Time taken in milliseconds
    };
}

export interface EndpointData {
    query?: Record<string, string | number | boolean | null>;
    headers?: Record<string, string>;
    body?: JsonValue;
}

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface WebSocketData {
    message?: string;
    timestamp: number;
    page?: PageDetails;
}

export interface ConnectionData {
    status: string;
    message: string;
}

export interface DisconnectionData {
    timestamp: number;
    statistics: Statistics;
    status: string;
    message: string;
}

export interface FirstConnectionData {
    pages: PageDetails[];
    messages: string[];
    timestamp: number;
}

// Enhanced message structure with sessionId
export interface LocalMessage {
    type: string;
    sessionId: string;
    data: WebSocketData | ConnectionData | FirstConnectionData | DisconnectionData;
    timestamp: string;
}

export interface Statistics {
    totalPagesVisited: number;
    totalLinksClicked: number;
    totalBugsFound: number;
    totalEndpointsTested: number;
    totalTokenUsage: number;
}

