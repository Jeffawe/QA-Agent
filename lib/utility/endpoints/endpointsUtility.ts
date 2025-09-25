// OpenAPI 3.0 Specification Types
export interface OpenAPISpec {
    openapi: string; // e.g., "3.0.0"
    info: {
        title: string;
        version: string;
        description?: string;
    };
    servers?: Array<{
        url: string;
        description?: string;
    }>;
    paths: Record<string, PathItem>;
    components?: {
        schemas?: Record<string, any>;
        responses?: Record<string, any>;
        parameters?: Record<string, any>;
        requestBodies?: Record<string, any>;
        headers?: Record<string, any>;
        securitySchemes?: Record<string, any>;
    };
    security?: Array<Record<string, any>>;
}

export interface PathItem {
    get?: Operation;
    post?: Operation;
    put?: Operation;
    delete?: Operation;
    patch?: Operation;
    head?: Operation;
    options?: Operation;
    trace?: Operation;
    parameters?: Parameter[];
}

export interface Operation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: Parameter[];
    requestBody?: RequestBody;
    responses: Record<string, Response>;
    security?: Array<Record<string, any>>;
    deprecated?: boolean;
}

export interface Parameter {
    name: string;
    in: 'query' | 'header' | 'path' | 'cookie';
    required?: boolean;
    schema: Schema;
    description?: string;
    example?: any;
}

export interface RequestBody {
    description?: string;
    content: Record<string, MediaType>;
    required?: boolean;
}

export interface MediaType {
    schema: Schema;
    example?: any;
    examples?: Record<string, any>;
}

export interface Response {
    description: string;
    content?: Record<string, MediaType>;
    headers?: Record<string, Header>;
}

export interface Header {
    description?: string;
    schema: Schema;
}

export interface Schema {
    type?: string;
    format?: string;
    properties?: Record<string, Schema>;
    items?: Schema;
    required?: string[];
    enum?: any[];
    example?: any;
    $ref?: string;
}

// Simplified endpoint map for your agent
export interface EndpointMap {
    baseUrl: string;
    endpoints: EndpointInfo[];
}

export interface EndpointInfo {
    path: string;
    method: string;
    operationId?: string;
    summary?: string;
    parameters: ParameterInfo[];
    requestBody?: RequestBodyInfo;
    responses: Record<string, ResponseInfo>;
    tags?: string[];
}

export interface ParameterInfo {
    name: string;
    location: 'query' | 'header' | 'path' | 'cookie';
    required: boolean;
    type: string;
    description?: string;
    example?: any;
}

export interface RequestBodyInfo {
    required: boolean;
    contentType: string;
    schema: any; // Simplified schema
}

export interface ResponseInfo {
    description: string;
    contentType?: string;
    schema?: any;
}

// Utility class to fetch and parse OpenAPI specs
export class OpenAPIFetcher {
    private static commonPaths = [
        '/swagger.json',
        '/openapi.json',
        '/api-docs',
        '/docs/swagger.json',
        '/api/docs/swagger.json',
        '/v1/swagger.json',
        '/api/v1/swagger.json',
        '/swagger/v1/swagger.json',
        '/api-docs.json'
    ];

    static async fetchSpec(baseUrl: string): Promise<OpenAPISpec | null> {
        // Remove trailing slash
        const cleanUrl = baseUrl.replace(/\/$/, '');

        // Try common paths
        for (const path of this.commonPaths) {
            try {
                const response = await fetch(`${cleanUrl}${path}`);
                if (response.ok) {
                    const spec = await response.json();
                    // Basic validation
                    if (spec.openapi || spec.swagger) {
                        return spec;
                    }
                }
            } catch (error) {
                console.log(`Failed to fetch ${cleanUrl}${path}:`, (error instanceof Error ? error.message : String(error)));
            }
        }

        // Try to find spec URL from the docs page
        try {
            const docsResponse = await fetch(`${cleanUrl}/docs`);
            if (docsResponse.ok) {
                const html = await docsResponse.text();
                const specUrl = this.extractSpecUrlFromHtml(html, cleanUrl);
                if (specUrl) {
                    const response = await fetch(specUrl);
                    if (response.ok) {
                        return await response.json();
                    }
                }
            }
        } catch (error) {
            console.log('Failed to parse docs page:', error instanceof Error ? error.message : String(error));
        }

        return null;
    }

    private static extractSpecUrlFromHtml(html: string, baseUrl: string): string | null {
        // Common patterns in Swagger UI HTML
        const patterns = [
            /url:\s*["']([^"']+)["']/,
            /spec-url=["']([^"']+)["']/,
            /"url":\s*["']([^"']+)["']/,
        ];

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
                let url = match[1];
                // Make relative URLs absolute
                if (url.startsWith('/')) {
                    url = baseUrl + url;
                } else if (!url.startsWith('http')) {
                    url = baseUrl + '/' + url;
                }
                return url;
            }
        }

        return null;
    }

    private static convertParameter(param: Parameter): ParameterInfo {
        return {
            name: param.name,
            location: param.in,
            required: param.required || false,
            type: param.schema?.type || 'string',
            description: param.description,
            example: param.example
        };
    }

    private static convertResponse(response: Response): ResponseInfo {
        const contentType = response.content ? Object.keys(response.content)[0] : undefined;
        return {
            description: response.description,
            contentType,
            schema: contentType ? response.content?.[contentType]?.schema : undefined
        };
    }

    private static resolveSchema(schemaRef: any, spec: OpenAPISpec): any {
        if (!schemaRef) return null;

        // Handle direct $ref
        if (schemaRef.$ref) {
            const refPath = schemaRef.$ref.replace('#/', '').split('/');
            let resolved: any = spec;

            for (const part of refPath) {
                resolved = resolved[part];
                if (!resolved) {
                    console.warn(`Could not resolve schema reference: ${schemaRef.$ref}`);
                    return null;
                }
            }

            // Recursively resolve the resolved schema too
            return this.resolveSchema(resolved, spec);
        }

        // Handle object with properties
        if (schemaRef.type === 'object' && schemaRef.properties) {
            const resolvedSchema = { ...schemaRef };
            resolvedSchema.properties = {};

            for (const [propName, propSchema] of Object.entries(schemaRef.properties)) {
                resolvedSchema.properties[propName] = this.resolveSchema(propSchema, spec);
            }

            return resolvedSchema;
        }

        // Handle arrays
        if (schemaRef.type === 'array' && schemaRef.items) {
            return {
                ...schemaRef,
                items: this.resolveSchema(schemaRef.items, spec)
            };
        }

        // Handle anyOf/oneOf
        if (schemaRef.anyOf) {
            return {
                ...schemaRef,
                anyOf: schemaRef.anyOf.map((schema: any) => this.resolveSchema(schema, spec))
            };
        }

        if (schemaRef.oneOf) {
            return {
                ...schemaRef,
                oneOf: schemaRef.oneOf.map((schema: any) => this.resolveSchema(schema, spec))
            };
        }

        // Return as-is if no $ref to resolve
        return schemaRef;
    }

    // Updated convertRequestBody to use recursive resolution
    private static convertRequestBody(requestBody: RequestBody, spec: OpenAPISpec): RequestBodyInfo | undefined {
        const contentType = Object.keys(requestBody.content)[0];
        if (!contentType) return undefined;

        const mediaType = requestBody.content[contentType];

        // Always resolve recursively
        const resolvedSchema = this.resolveSchema(mediaType.schema, spec);

        return {
            required: requestBody.required || false,
            contentType,
            schema: resolvedSchema
        };
    }

    // Update the main convert method to pass spec
    static convertToEndpointMap(spec: OpenAPISpec): EndpointMap {
        const baseUrl = spec.servers?.[0]?.url || '';
        const endpoints: EndpointInfo[] = [];

        for (const [path, pathItem] of Object.entries(spec.paths)) {
            const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

            for (const method of methods) {
                const operation = pathItem[method];
                if (operation) {
                    endpoints.push({
                        path,
                        method: method.toUpperCase(),
                        operationId: operation.operationId,
                        summary: operation.summary,
                        parameters: [
                            ...(pathItem.parameters?.map(p => this.convertParameter(p)) || []),
                            ...(operation.parameters?.map(p => this.convertParameter(p)) || [])
                        ],
                        requestBody: operation.requestBody ? this.convertRequestBody(operation.requestBody, spec) : undefined,
                        responses: Object.entries(operation.responses).reduce((acc, [code, response]) => {
                            acc[code] = this.convertResponse(response);
                            return acc;
                        }, {} as Record<string, ResponseInfo>),
                        tags: operation.tags
                    });
                }
            }
        }

        return { baseUrl, endpoints };
    }
}

// Usage example:
export async function getEndpointMap(siteUrl: string): Promise<EndpointMap | null> {
    try {
        const spec = await OpenAPIFetcher.fetchSpec(siteUrl);
        if (!spec) {
            console.error('Could not find OpenAPI specification');
            return null;
        }

        return OpenAPIFetcher.convertToEndpointMap(spec);
    } catch (error) {
        console.error('Error fetching endpoint map:', error);
        return null;
    }
}