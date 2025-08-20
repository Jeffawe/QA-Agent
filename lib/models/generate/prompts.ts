import { Namespaces } from "../../types.js";
import { z } from "zod";

export const systemPromptSchema = z.object({
    analysis: z.object({
        bugs: z.array(
            z.object({
                description: z.string().describe("Description of the bug found"),
                selector: z.string().describe("CSS selector identifying the problematic element"),
                severity: z.enum(["low", "medium", "high"]).describe("Severity level of the bug")
            })
        ).describe("Array of bugs found on the page"),

        ui_issues: z.array(
            z.object({
                description: z.string().describe("Description of the UI issue"),
                selector: z.string().describe("CSS selector identifying the UI element with issues"),
                severity: z.enum(["low", "medium", "high"]).describe("Severity level of the UI issue")
            })
        ).describe("Array of UI issues found on the page"),

        notes: z.string().describe("Any extra observations about this page")
    }).describe("Analysis of the current page"),

    action: z.object({
        step: z.string().describe("The command name to execute"),
        args: z.array(z.any()).describe("Arguments for the command"),
        reason: z.string().describe("Why this command keeps the crawl progressing (Make it short)"),
        newGoal: z.string().describe("New mission goal for the next step"),
        nextLink: z.string().optional().describe("The next link to click on (Must be picked out of the available labels given to you. Leave as blank if not applicable)")
    }).describe("Action to take next"),

    pageDetails: z.object({
        pageName: z.string().describe("Name of the page you are currently on"),
        description: z.string().describe("Short description of the page you are currently on")
    }).describe("Details about the current page")
});

export const actionSchema = z.object({
    step: z.string().describe("The command name to execute"),
    args: z.array(z.any()).describe("Arguments for the command"),
    reason: z.string().describe("Why this command keeps the crawl progressing (Make it short)"),
    newGoal: z.string().describe("New mission goal for the next step"),
    nextLink: z.string().optional().describe("The next link to click on (Must be picked out of the available labels given to you. Leave as blank if not applicable)")
});

const goalSchema = z.object({
    analysis: z.object({
        bugs: z.array(
            z.object({
                description: z.string().describe("Description of the bug found (e.g. 'Login button unresponsive')"),
                selector: z.string().describe("CSS selector identifying the problematic element (e.g. '#btn-login')"),
                severity: z.enum(["low", "medium", "high"]).describe("Severity level of the bug")
            })
        ).describe("Array of bugs found on the page"),

        ui_issues: z.array(
            z.object({
                description: z.string().describe("Description of the UI issue (e.g. 'Text too small on mobile')"),
                selector: z.string().describe("CSS selector identifying the UI element with issues (e.g. '.footer-note')"),
                severity: z.enum(["low", "medium", "high"]).describe("Severity level of the UI issue")
            })
        ).describe("Array of UI issues found on the page"),

        notes: z.string().describe("Any extra observations about this page (e.g. 'This page appears to be a login form using React. No errors in console.')")
    }).describe("Analysis of the current page"),

    action: z.object({
        step: z.string().describe("Action to perform - must match one of the given possibleLabels exactly (if you wish the system to wait for a period of time, just put 'wait' here)"),
        args: z.array(z.any()).describe("Arguments for the action, e.g. time to wait in milliseconds [5000]"),
        reason: z.string().describe("The reason for this action"),
        progressDescription: z.string().describe("Description of current progress (e.g. 'Filled login form and submitting credentials')"),
        newGoal: z.string().describe("New mission goal for the next step (e.g. 'Wait for dashboard to load after login')"),
        hasAchievedGoal: z.boolean().describe("Whether the current goal has been achieved")
    }).describe("Action to take next")
});

const systemPrompt = String.raw`
            You are a website-auditing autonomous agent.

            ▸ MISSION
            Your current mission will be given as goal. (external redirects are forbidden except for the login flow).
            For **each page you land on**, do two things:

                1. Analyse—
                • Look for functional bugs (broken links, console errors, 404s, JS exceptions)
                • Flag UX / UI issues (misaligned elements, unreadable contrast, missing alt text, CLS jank, etc.)
                • Note performance hints (large images, long TTFB)
                • Record any helpful contextual info (page purpose, detected frameworks, etc.)

                2. Decide the single next navigation / interaction that keeps the crawl moving inside the site.

            ▸ RESOURCES YOU HAVE
            • Screenshot of the full page (inline image) labelled for the different UI elements
            • Your last action and a short-term memory of prior attempts
            • A list of possible labels to pick from (UI elements in the page. Don't pick outside of it when using click)
            • A validator may sometimes give messages on issues you made

            ▸ ALLOWED COMMANDS (one per response)
            - click (buttons, links)
            - scroll (up/down)
            - type (text input, search fields)
            - navigate (back to a previous page / forward in args)
            - wait
            - done   (when the entire site has been audited)

            Arguments for each command should be in the args array.

            ▸ RESPONSE FORMAT  
            Return **exactly one** JSON object, no commentary, in this schema:
        `;


const systemActionPrompt = String.raw`
            You are a website-auditing autonomous agent.

            ▸ MISSION
            Your current mission will be given as goal. (external redirects are forbidden except for the login flow).
            For **each page you land on**, do one thing:

                1. Decide the single next navigation / interaction that keeps the crawl moving inside the site.

            ▸ RESOURCES YOU HAVE
            • Screenshot of the full page (inline image) labelled for the different UI elements
            • Your last action and a short-term memory of prior attempts
            • A list of possible labels to pick from (UI elements in the page. Don't pick outside of it when using click)
            • A validator may sometimes give messages on issues you made

            ▸ ALLOWED COMMANDS (one per response)
            - click (buttons, links)
            - scroll (up/down)
            - type (text input, search fields)
            - navigate (back to a previous page / forward in args)
            - wait
            - done   (when the entire site has been audited)

            Arguments for each command should be in the args array.

            ▸ RESPONSE FORMAT  
            Return **exactly one** JSON object, no commentary, in this schema:
        `;


const systemGoalPrompt = String.raw`
    You are a QA automation agent assigned to test websites by achieving high-level goals (like "Log into the dashboard", "Create a new post", etc.).

    ▸ MISSION
    You will be given:
    - A **mainGoal** (the full QA task, like "Log in and reach dashboard")
    - A **goal** (the immediate subgoal for this step)

    At every page or step:
    1. **Analyze the page**
        • List any functional bugs (broken links, JS exceptions, 404s, console errors, etc.)
        • Flag UI/UX issues (misaligned elements, bad contrast, missing alt text, layout shifts, confusing navigation, etc.)
        • Note performance hints (large uncompressed images, slow loads, high TTFB)
        • Include any useful observations (e.g., "this is clearly a signup form", "React detected", "login button is disabled")

    2. **Decide the best next action**
        • Pick the **most relevant label** from the provided list of possibleLabels to take the next step toward achieving the **main goal**
        • Formulate a new **goal** for the next step
        • Indicate whether the **main goal has now been achieved**

    You must act **step-by-step**, fulfilling each subgoal before progressing. Never skip steps or assume the main goal is complete without confirmation.

    ▸ INPUTS AVAILABLE TO YOU
    • A full-page screenshot with labeled elements (visual UI context)
    • The list of possibleLabels (these are the only legal targets for your next action)
    • Your previous action and short-term memory of prior steps
    • Optional validator warnings from the last run (to help you fix mistakes)

    ▸ FORMAT (return exactly one JSON object, no commentary)
    `;

export const getSystemPrompt = (agentName: Namespaces, recurrent: boolean): string => {
    if (agentName === "analyzer") {
        return recurrent ? systemActionPrompt : systemPrompt;
    } else {
        return systemGoalPrompt;
    }
}

export const getSystemSchema = (agentName: Namespaces, recurrent: boolean) => {
    if (agentName === "analyzer") {
        return recurrent ? actionSchema : systemPromptSchema;
    } else {
        return goalSchema;
    }
}

export const STOP_LEVEL_ERRORS = [
    'Invalid Gemini API key',
    'API key not valid',
    'Gemini API quota exceeded',
    'Gemini API client cannot be initialized. Please check your API key',
    'quota exceeded',
    'Authentication failed',
    'Unauthorized access',
    'Rate limit exceeded',
    'Service unavailable',
    'Network timeout',
    'Connection refused',
    'DNS resolution failed',
    'Failed to upload image to Gemini',
    'SSL handshake failed',
    'Permission denied',
    'Access forbidden',
    'Invalid credentials',
    'Token expired',
    'Service temporarily unavailable',
    'Internal server error',
    'Database connection lost',
    'Critical system failure',
    'Memory allocation failed',
    'Disk space full',
    'Configuration error',
    'Dependency not found'
];