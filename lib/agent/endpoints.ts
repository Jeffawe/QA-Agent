import { EndpointData, EndPointTestResult, State } from "../types.js";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import { EndpointInfo, EndpointMap, getEndpointMap, ParameterInfo, RequestBodyInfo } from "../utility/endpoints/endpointsUtility.js";
import { dataMemory } from "../services/memory/dataMemory.js";
import PlaywrightSession from "../browserAuto/playWrightSession.js";
import ManualActionService from "../services/actions/actionService.js";
import { pageMemory } from "../services/memory/pageMemory.js";
import { crawlMap } from "../utility/crawlMap.js";
import { extractErrorMessage } from "../utility/functions.js";

const MAX_CHARS = 1200; // safe limit for logs/results
const MAX_LINES = 200; // also limit lines for extremely long newline-separated payloads

interface TestData {
    pathParams: Record<string, any>;
    queryParams: Record<string, any>;
    headers: Record<string, any>;
    body: any | null;
}

interface EndpointDataFull {
    key: string;
    endpoint: EndpointData;
}

export default class EndPoints extends Agent {
    private mainGoal: string;
    private warning: string = "";
    private finalUrl: string = "";
    public endpointMap: EndpointMap | null = null;
    public results: EndPointTestResult[] = [];

    private playwrightSession: PlaywrightSession;
    private localactionService: ManualActionService;

    constructor(dependencies: BaseAgentDependencies) {
        super("endpointagent", dependencies);
        this.mainGoal = "";
        this.setState(dependencies.dependent ? State.WAIT : State.START);

        this.playwrightSession = this.session as PlaywrightSession;
        this.localactionService = this.actionService as ManualActionService;
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof PlaywrightSession)) {
            this.logManager.error(`EndpointAgent requires PuppeteerSession, got ${this.session.constructor.name}`);
            this.setStateError(`EndpointAgent requires PuppeteerSession, got ${this.session.constructor.name}`);
            throw new Error(`EndpointAgent requires PuppeteerSession, got ${this.session.constructor.name}`);
        }

        this.playwrightSession = this.session as PlaywrightSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof ManualActionService)) {
            this.logManager.error(`EndpointAgent requires an appropriate action service`);
            this.setStateError(`EndpointAgent requires an appropriate action service`);
            throw new Error(`EndpointAgent requires an appropriate action service`);
        }

        this.localactionService = this.actionService as ManualActionService;
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
                    (this as any).start = Date.now();
                    if (!this.baseUrl) {
                        this.logManager.error("Base URL is not set.", this.buildState());
                        this.setState(State.DONE);
                        return;
                    }
                    this.endpointMap = await getEndpointMap(this.baseUrl);
                    if (!this.endpointMap) {
                        this.logManager.log("Failed to fetch or parse OpenAPI specification.", this.buildState());
                        this.setState(State.DONE);
                        return;
                    }
                    this.setState(State.ACT);
                    break;

                case State.ACT:
                    const data = dataMemory.getAllData();
                    if (!this.endpointMap) {
                        this.logManager.error("Endpoint map is not available.", this.buildState());
                        this.setState(State.DONE);
                        return;
                    }
                    this.finalUrl = this.baseUrl + (this.endpointMap.baseUrl || "");
                    this.results = await this.runBaseTesting(
                        this.endpointMap.endpoints,
                        this.finalUrl,
                        new Map(Object.entries(data))
                    );
                    this.setState(State.VALIDATE);
                    break;

                case State.VALIDATE:
                    const endTime = Date.now();
                    const duration = ((endTime - (this as any).start) / 1000).toFixed(2);
                    this.logManager.log(`Endpoint testing completed in ${duration} seconds.`, this.buildState());
                    if (this.results.length === 0) {
                        this.logManager.log("No endpoints were tested.", this.buildState());
                        this.setState(State.DONE);
                        break;
                    }
                    pageMemory.addPageWithURL(this.finalUrl, this.finalUrl);
                    pageMemory.addEndpointResults(this.finalUrl, this.results);
                    crawlMap.addPageWithURL(this.finalUrl);
                    this.logManager.log(`✅ Tested ${this.results.length} endpoints for ${this.finalUrl}`, this.buildState());
                    this.setState(State.DONE);
                    break;

                case State.PAUSE:
                case State.ERROR:
                case State.DONE:
                default:
                    break;
            }
        }
        catch (e) {
            const err = extractErrorMessage(e);
            this.logManager.error(err, this.buildState());
            this.setStateError(err);
        }
    }

    async cleanup(): Promise<void> {

    }

    // Generate test values based on parameter info
    generateTestValue(param: ParameterInfo, userMappings: Map<string, any>): any {
        // First check user-provided mappings (fuzzy match)
        const userValue = this.findUserMapping(param.name, param.type, userMappings);
        if (userValue !== null) return userValue;

        // Fall back to static generation
        return this.generateStaticValue(param.type, param.name);
    }

    // Fuzzy match user mappings to parameter names
    findUserMapping(paramName: string, paramType: string, userMappings: Map<string, any>): any | null {
        const lowerParamName = paramName.toLowerCase();

        for (const [key, value] of userMappings) {
            if (key.startsWith('header') || key.startsWith('auth')) continue; // Skip sensitive info

            const lowerKey = key.toLowerCase();

            // Exact match
            if (lowerKey === lowerParamName) return value;

            // Fuzzy matching - contains
            if (lowerParamName.includes(lowerKey) || lowerKey.includes(lowerParamName)) {
                // Type check
                if (typeof value === paramType || paramType === 'string') {
                    return value;
                }
            }
        }

        return null;
    }

    // Generate static test values
    generateStaticValue(type: string, paramName: string): any {
        const name = paramName.toLowerCase();

        // Context-aware generation
        if (name.includes('email')) return 'test@example.com';
        if (name.includes('phone')) return '+1234567890';
        if (name.includes('url')) return 'https://example.com';
        if (name.includes('id')) return 'test_id_123';
        if (name.includes('name')) return 'TestName';
        if (name.includes('age')) return 25;
        if (name.includes('count') || name.includes('limit')) return 10;

        // Type-based fallbacks
        switch (type) {
            case 'string': return 'test_string';
            case 'integer': return 123;
            case 'number': return 123.45;
            case 'boolean': return true;
            case 'array': return ['test'];
            case 'object': return { test: 'value' };
            default: return 'test_value';
        }
    }

    /**
     * Finds an endpoint in the user's provided endpoints that matches the given endpoint path.
     * The path is converted into a regex to allow for dynamic parameters (e.g. "/create/{id}" becomes "/create/([^/]+)")
     * @param endpoint The endpoint to search for in the user's provided endpoints
     * @param userEndpoints The user's provided endpoints
     * @returns The matching endpoint data or null if not found
     */
    private findMemoryEndpoint(
        endpoint: EndpointInfo,
        userEndpoints: Map<string, EndpointData>
    ): EndpointDataFull | null {
        for (const [path, data] of userEndpoints) {
            // Turn "/create/{id}" into regex "/create/([^/]+)"
            const regexPath = endpoint.path.replace(/\{[^}]+\}/g, '([^/]+)');
            const regex = new RegExp(`^${regexPath}$`);

            if (regex.test(path)) {
                return {
                    key: path,
                    endpoint: data
                }
            }
        }
        return null;
    }

    // Test a single endpoint with base logic
    testEndpointBase(endpoint: EndpointInfo, userMappings: Map<string, any>) {
        const testData: TestData = {
            pathParams: {},
            queryParams: {},
            headers: {},
            body: null,
        };

        // Fill parameters
        endpoint.parameters.forEach(param => {
            const value = this.generateTestValue(param, userMappings);

            switch (param.location) {
                case 'path':
                    testData.pathParams[param.name] = value;
                    break;
                case 'query':
                    testData.queryParams[param.name] = value;
                    break;
                case 'header':
                    testData.headers[param.name] = value;
                    break;
            }
        });

        // Fill request body if needed
        if (endpoint.requestBody?.required) {
            testData.body = this.generateRequestBody(endpoint.requestBody, userMappings);
        }

        return testData;
    }

    private buildTestDataFromMemory(
        endpoint: EndpointInfo,
        memoryData: EndpointDataFull,
        userMappings: Map<string, any>,
    ): TestData {
        const testData: TestData = {
            pathParams: {},
            queryParams: {},
            headers: {},
            body: null,
        };

        // Path params → generate normally (these come from OpenAPI definition)
        endpoint.parameters.forEach(param => {
            if (param.location === 'path') {
                // Default: generate test value
                let value = this.generateTestValue(param, userMappings);

                // If testData.url exists, try to extract value from it
                if (memoryData.key) {
                    // Remove base URL if present
                    let relativeUrl = memoryData.key.startsWith('http') ? new URL(memoryData.key).pathname : memoryData.key;

                    // Convert endpoint path to regex with capture groups
                    const regexStr = endpoint.path.replace(/\{[^}]+\}/g, '([^/]+)');
                    const regex = new RegExp(`^${regexStr}$`);
                    const match = relativeUrl.match(regex);

                    if (match) {
                        // Extract parameter names
                        const paramNames = Array.from(endpoint.path.matchAll(/\{([^}]+)\}/g), m => m[1]);
                        const index = paramNames.indexOf(param.name);
                        if (index >= 0 && match[index + 1] !== undefined) {
                            value = decodeURIComponent(match[index + 1]);
                        }
                    }
                }

                testData.pathParams[param.name] = value;
            }
        });


        // Query params → prefer memory, fallback to global data, then generate
        endpoint.parameters.forEach(param => {
            if (param.location === 'query') {
                if (memoryData.endpoint.query && (memoryData.endpoint.query as any)[param.name] !== undefined) {
                    testData.queryParams[param.name] = (memoryData.endpoint.query as any)[param.name];
                } else if (dataMemory.hasData(param.name)) {
                    testData.queryParams[param.name] = dataMemory.getData(param.name);
                } else {
                    testData.queryParams[param.name] = this.generateTestValue(param, userMappings);
                }
            }
        });

        // Headers → same priority order
        endpoint.parameters.forEach(param => {
            if (param.location === 'header') {
                if (memoryData.endpoint.headers && memoryData.endpoint.headers[param.name] !== undefined) {
                    testData.headers[param.name] = memoryData.endpoint.headers[param.name];
                } else if (dataMemory.hasData(param.name)) {
                    testData.headers[param.name] = dataMemory.getData(param.name) as string;
                } else {
                    testData.headers[param.name] = this.generateTestValue(param, userMappings);
                }
            }
        });

        // Body → prefer memory body, else fallback to global data, else generate
        if (endpoint.requestBody?.required) {
            if (memoryData.endpoint.body) {
                testData.body = memoryData.endpoint.body;
            } else if (dataMemory.hasData("body")) {
                testData.body = dataMemory.getData("body");
            } else {
                testData.body = this.generateRequestBody(endpoint.requestBody, userMappings);
            }
        }

        return testData;
    }



    async runBaseTesting(
        endpoints: EndpointInfo[],
        baseUrl: string,
        userMappings: Map<string, any>
    ): Promise<EndPointTestResult[]> {
        const results: EndPointTestResult[] = [];

        this.logManager.log(`Starting endpoint testing for ${endpoints.length} endpoints for url: ${baseUrl}.`, this.buildState(), true);

        for (const endpoint of endpoints) {
            const endpointName = `${endpoint.method} ${endpoint.path}`;

            try {
                const memoryData = this.findMemoryEndpoint(endpoint, dataMemory.getAllEndpointsMap());

                let testData: TestData;
                if (memoryData) {
                    testData = this.buildTestDataFromMemory(endpoint, memoryData, userMappings);
                } else {
                    testData = this.testEndpointBase(endpoint, userMappings);
                }

                const headerData = this.extractHeaderData(userMappings);
                testData.headers = {
                    ...testData.headers,
                    ...headerData
                };
                const response = await this.executeRequest(endpoint, baseUrl, testData);

                results.push({
                    endpoint: endpointName,
                    request: {
                        method: endpoint.method,
                        headers: testData.headers,
                        body: testData.body || undefined
                    },
                    success: true,
                    response
                });

            } catch (error) {
                results.push({
                    endpoint: endpointName,
                    request: {
                        method: endpoint.method,
                        headers: {},
                    },
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return results;
    }

    private extractHeaderData(userMappings: Map<string, any>): Record<string, string> {
        const headers: Record<string, string> = {};

        for (const [rawKey, value] of userMappings) {
            if (!rawKey) continue;
            const key = String(rawKey);

            // Only consider keys that start with "header" (case-insensitive)
            if (!/^header/i.test(key)) continue;

            // Remove the "header" prefix and any separators that follow
            let headerName = key.replace(/^header[:_.\-]*/i, '');

            // If nothing left after prefix, skip
            if (!headerName) continue;

            // Normalize separators to hyphens (common header format)
            headerName = headerName.replace(/[:_.]+/g, '-');

            // If headerName looks camelCase (e.g. "Authorization"), keep as-is but ensure first letter case is reasonable
            // Preserve case for common headers; otherwise convert to standard capitalization for readability
            // Use the raw headerName as-is for the header key
            headers[headerName] = String(value);
        }

        return headers;
    }

    async executeRequest(
        endpoint: EndpointInfo,
        baseUrl: string,
        testData: TestData
    ): Promise<EndPointTestResult['response']> {
        const startTime = Date.now();

        // Clean and validate baseUrl
        let cleanBaseUrl = baseUrl.trim();
        if (!cleanBaseUrl) {
            throw new Error('Base URL is empty');
        }

        // Add protocol if missing
        if (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://')) {
            cleanBaseUrl = 'https://' + cleanBaseUrl;
        }

        // Remove trailing slash
        cleanBaseUrl = cleanBaseUrl.replace(/\/$/, '');

        // Build the URL - ensure endpoint path starts with /
        let path = endpoint.path;
        if (!path.startsWith('/')) {
            path = '/' + path;
        }

        let url = cleanBaseUrl + path;

        // Replace path parameters
        for (const [key, value] of Object.entries(testData.pathParams)) {
            if (typeof value === "boolean") {
                url = url.replace(`{${key}}`, value ? "true" : "false");
            } else if (typeof value === "number") {
                url = url.replace(`{${key}}`, String(value));
            } else {
                url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
            }
        }

        // Add query parameters
        if (Object.keys(testData.queryParams).length > 0) {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(testData.queryParams)) {
                if (value !== null && value !== undefined) {
                    if (typeof value === "boolean") {
                        searchParams.append(key, value ? "true" : "false");
                    } else if (typeof value === "number") {
                        searchParams.append(key, String(value));
                    } else {
                        searchParams.append(key, String(value));
                    }
                }
            }
            const queryString = searchParams.toString();
            if (queryString) {
                url += "?" + queryString;
            }
        }

        this.logManager.log(`Making request to: ${url}`, this.buildState(), true); // Debug log

        // Validate final URL
        try {
            new URL(url); // This will throw if URL is invalid
        } catch (error) {
            this.logManager.log(`Invalid URL: ${url}`, this.buildState(), true);
        }

        // Prepare request options
        const options: RequestInit = {
            method: endpoint.method,
            headers: {
                'Content-Type': 'application/json',
                ...testData.headers
            }
        };

        // Add body for non-GET requests
        if (testData.body !== null && !['GET', 'HEAD'].includes(endpoint.method)) {
            options.body = JSON.stringify(testData.body);
        }

        // Make the request
        const response = await fetch(url, options);
        const endTime = Date.now();

        // Parse response
        let data: any;
        const contentType = response.headers.get('content-type') || '';

        try {
            if (contentType.includes('application/json')) {
                const text = await response.text();
                data = text ? JSON.parse(text) : {};
            } else {
                data = await response.text();
            }
        } catch (parseError) {
            data = await response.text(); // Fallback to text
        }

        // Convert headers to plain object
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        const cleanedData = this.cleanResponseData(data, contentType);

        return {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data: cleanedData,
            responseTime: endTime - startTime,
            url
        };
    }

    private cleanResponseData(data: any, contentType: string): any {
        // Preserve proper JSON objects/arrays untouched
        if (data === null || data === undefined) return data;
        if (typeof data === 'object') return data;

        // Ensure we have a string to work with
        let s = typeof data === 'string' ? data : String(data);
        s = s.trim();

        // If content-type is JSON-like but parsing failed earlier, attempt to parse again and return object if possible
        if (!contentType.includes('application/json')) {
            // heuristics: if string looks like JSON, try parse
            if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
                try {
                    return JSON.parse(s);
                } catch {
                    // fall through to truncation
                }
            }
        }

        if (s.length > MAX_CHARS) {
            return s.slice(0, MAX_CHARS) + `\n... (truncated, original length=${s.length})`;
        }

        const lines = s.split(/\r?\n/);
        if (lines.length > MAX_LINES) {
            return lines.slice(0, MAX_LINES).join('\n') + `\n... (truncated lines, original lines=${lines.length})`;
        }

        return s;
    }

    generateRequestBody(requestBody: RequestBodyInfo, userMappings: Map<string, any>): any {
        if (!requestBody.schema) {
            return { test: 'data' }; // Fallback if no schema
        }

        return this.generateFromSchema(requestBody.schema, userMappings);
    }

    generateFromSchema(schema: any, userMappings: Map<string, any>): any {
        if (!schema) return null;

        switch (schema.type) {
            case 'object':
                const obj: Record<string, any> = {};

                if (schema.properties) {
                    for (const [propName, propSchema] of Object.entries(schema.properties)) {
                        // Check if this property is required
                        const isRequired = schema.required?.includes(propName) || false;

                        if (isRequired || Math.random() > 0.5) { // Include required + some optional
                            const value = this.findUserMapping(propName, (propSchema as any).type, userMappings);

                            if (value !== null) {
                                obj[propName] = value;
                            } else {
                                obj[propName] = this.generateFromSchema(propSchema, userMappings);
                            }
                        }
                    }
                }

                return obj;

            case 'array':
                if (schema.items) {
                    return [this.generateFromSchema(schema.items, userMappings)];
                }
                return ['test'];

            case 'string':
                return this.generateStaticValue('string', '');
            case 'integer':
                return this.generateStaticValue('integer', '');
            case 'number':
                return this.generateStaticValue('number', '');
            case 'boolean':
                return this.generateStaticValue('boolean', '');

            default:
                return 'test_value';
        }
    }
}
