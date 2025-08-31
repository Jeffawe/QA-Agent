import { Namespaces } from "../../types.js";

export const systemPromptJsonSchema = {
    type: "object",
    properties: {
        analysis: {
            type: "object",
            properties: {
                bugs: {
                    type: "array",
                    description: "Array of bugs found on the page",
                    items: {
                        type: "object",
                        properties: {
                            description: {
                                type: "string",
                                description: "Description of the bug found"
                            },
                            selector: {
                                type: "string",
                                description: "CSS selector identifying the problematic element"
                            },
                            severity: {
                                type: "string",
                                enum: ["low", "medium", "high"],
                                description: "Severity level of the bug"
                            }
                        },
                        required: ["description", "selector", "severity"],
                        additionalProperties: false
                    }
                },
                ui_issues: {
                    type: "array",
                    description: "Array of UI issues found on the page",
                    items: {
                        type: "object",
                        properties: {
                            description: {
                                type: "string",
                                description: "Description of the UI issue"
                            },
                            selector: {
                                type: "string",
                                description: "CSS selector identifying the UI element with issues"
                            },
                            severity: {
                                type: "string",
                                enum: ["low", "medium", "high"],
                                description: "Severity level of the UI issue"
                            }
                        },
                        required: ["description", "selector", "severity"],
                        additionalProperties: false
                    }
                },
                notes: {
                    type: "string",
                    description: "Any extra observations about this page"
                }
            },
            required: ["bugs", "ui_issues", "notes"],
            additionalProperties: false,
            description: "Analysis of the current page"
        },
        action: {
            type: "object",
            properties: {
                step: {
                    type: "string",
                    description: "The command name to execute"
                },
                args: {
                    type: "array",
                    description: "Arguments for the command",
                    items: {
                        oneOf: [
                            { type: "string" },
                            { type: "number" },
                            { type: "boolean" },
                            { type: "null" }
                        ]
                    }
                },
                reason: {
                    type: "string",
                    description: "Why this command keeps the crawl progressing (Make it short)"
                },
                newGoal: {
                    type: "string",
                    description: "New mission goal for the next step"
                },
                nextLink: {
                    type: "string",
                    description: "The next link to click on (Must be picked out of the available labels given to you. Leave as blank if not applicable)"
                }
            },
            required: ["step", "args", "reason", "newGoal"],
            additionalProperties: false,
            description: "Action to take next"
        },
        pageDetails: {
            type: "object",
            properties: {
                pageName: {
                    type: "string",
                    description: "Name of the page you are currently on"
                },
                description: {
                    type: "string",
                    description: "Short description of the page you are currently on"
                }
            },
            required: ["pageName", "description"],
            additionalProperties: false,
            description: "Details about the current page"
        }
    },
    required: ["analysis", "action", "pageDetails"],
    additionalProperties: false
};

export const actionJsonSchema = {
    type: "object",
    properties: {
        step: {
            type: "string",
            description: "The command name to execute"
        },
        args: {
            type: "array",
            description: "Arguments for the command",
            items: {
                oneOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                    { type: "null" }
                ]
            }
        },
        reason: {
            type: "string",
            description: "Why this command keeps the crawl progressing (Make it short)"
        },
        newGoal: {
            type: "string",
            description: "New mission goal for the next step"
        },
        nextLink: {
            type: "string",
            description: "The next link to click on (Must be picked out of the available labels given to you. Leave as blank if not applicable)"
        }
    },
    required: ["step", "args", "reason", "newGoal"],
    additionalProperties: false
};

export const testJsonSchema = {
    type: "object",
    properties: {
        confirmation: {
            type: "string",
            description: "Confirmation of the action taken (e.g. 'Login successful', 'Page loaded')"
        }
    },
    required: ["confirmation"],
    additionalProperties: false
};

export const goalJsonSchema = {
    type: "object",
    properties: {
        analysis: {
            type: "object",
            properties: {
                bugs: {
                    type: "array",
                    description: "Array of bugs found on the page",
                    items: {
                        type: "object",
                        properties: {
                            description: {
                                type: "string",
                                description: "Description of the bug found (e.g. 'Login button unresponsive')"
                            },
                            selector: {
                                type: "string",
                                description: "CSS selector identifying the problematic element (e.g. '#btn-login')"
                            },
                            severity: {
                                type: "string",
                                enum: ["low", "medium", "high"],
                                description: "Severity level of the bug"
                            }
                        },
                        required: ["description", "selector", "severity"],
                        additionalProperties: false
                    }
                },
                ui_issues: {
                    type: "array",
                    description: "Array of UI issues found on the page",
                    items: {
                        type: "object",
                        properties: {
                            description: {
                                type: "string",
                                description: "Description of the UI issue (e.g. 'Text too small on mobile')"
                            },
                            selector: {
                                type: "string",
                                description: "CSS selector identifying the UI element with issues (e.g. '.footer-note')"
                            },
                            severity: {
                                type: "string",
                                enum: ["low", "medium", "high"],
                                description: "Severity level of the UI issue"
                            }
                        },
                        required: ["description", "selector", "severity"],
                        additionalProperties: false
                    }
                },
                notes: {
                    type: "string",
                    description: "Any extra observations about this page (e.g. 'This page appears to be a login form using React. No errors in console.')"
                }
            },
            required: ["bugs", "ui_issues", "notes"],
            additionalProperties: false,
            description: "Analysis of the current page"
        },
        action: {
            type: "object",
            properties: {
                step: {
                    type: "string",
                    description: "Action to perform - must match one of the given possibleLabels exactly (if you wish the system to wait for a period of time, just put 'wait' here)"
                },
                args: {
                    type: "array",
                    description: "Arguments for the action, e.g. time to wait in milliseconds [5000]",
                    items: {
                        oneOf: [
                            { type: "string" },
                            { type: "number" },
                            { type: "boolean" },
                            { type: "null" }
                        ]
                    }
                },
                reason: {
                    type: "string",
                    description: "The reason for this action"
                },
                progressDescription: {
                    type: "string",
                    description: "Description of current progress (e.g. 'Filled login form and submitting credentials')"
                },
                newGoal: {
                    type: "string",
                    description: "New mission goal for the next step (e.g. 'Wait for dashboard to load after login')"
                },
                hasAchievedGoal: {
                    type: "boolean",
                    description: "Whether the current goal has been achieved"
                }
            },
            required: ["step", "args", "reason", "progressDescription", "newGoal", "hasAchievedGoal"],
            additionalProperties: false,
            description: "Action to take next"
        }
    },
    required: ["analysis", "action"],
    additionalProperties: false
};


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

const systemAutoPrompt = String.raw`
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
            - In the step of Action - it must be a string that matches one of the given possibleLabels exactly (if you wish the system to wait for a period of time, just put 'wait' here), 
            - Set step to 'done' - it means the entire site has been audited and goal has been achieved for this.

            Arguments for each command should be in the args array.

            ▸ RESPONSE FORMAT  
            Return **exactly one** JSON object, no commentary, in this schema:
        `;


const systemActionAutoPrompt = String.raw`
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
            - In the step of Action - it must be a string that matches one of the given possibleLabels exactly (if you wish the system to wait for a period of time, just put 'wait' here), 
            - Set step to 'done' - it means the entire site has been audited and goal has been achieved for this.

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
    } else if (agentName === "autoanalyzer") {
        return recurrent ? systemActionAutoPrompt : systemAutoPrompt;
    } else {
        return systemGoalPrompt;
    }
}

// Updated schema getter function
export const getSystemSchema = (agentName: Namespaces, recurrent: boolean) => {
    if (agentName === "analyzer" || agentName === "autoanalyzer") {
        return recurrent ? actionJsonSchema : systemPromptJsonSchema;
    } else {
        return goalJsonSchema;
    }
};

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