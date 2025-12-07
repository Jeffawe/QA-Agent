import { EndpointData, JsonValue } from "../../types.js";

class DataMemory {
    private data = new Map<string, JsonValue>();
    private endpoints = new Map<string, EndpointData>();

    constructor() { }

    initialize() { }

    clear() {
        this.data.clear();
    }

    setData(key: string, value: any) {
        this.data.set(key, value);
    }

    getData(key: string) : JsonValue | undefined {
        return this.data.get(key);
    }

    deleteData(key: string) {
        this.data.delete(key);
    }

    /**
     * Load data from an object into the Map
     * @param dataObject - Object containing key-value pairs to load into memory
     * @param options - Configuration options for loading
     */
    loadData(
        dataObject: Record<string, any>,
        options: { overwrite?: boolean; prefix?: string } = {}
    ) {
        const { overwrite = true, prefix = '' } = options;

        if (!dataObject || typeof dataObject !== 'object') {
            console.warn('DataMemory.loadData: Invalid data object provided');
            return;
        }

        Object.entries(dataObject).forEach(([key, value]) => {
            let finalKey = prefix ? `${prefix}.${key}` : key;
            finalKey = finalKey.replace(/^\./, '').trim().toLowerCase();

            // --- detect if this is an endpoint ---
            const isEndpoint =
                finalKey.startsWith('/') ||
                (finalKey.startsWith('endpoint:') && finalKey.includes(':'));

            if (isEndpoint) {
                // strip "endpoint:" if present
                const endpointKey = finalKey.startsWith('endpoint:')
                    ? finalKey.replace(/^endpoint:/, '')
                    : finalKey;

                // normalize endpoint into { query, headers, body }
                let query: Record<string, any> = {};
                let headers: Record<string, any> = {};
                let body: Record<string, any> = {};

                if (value && typeof value === 'object' && ('query' in value || 'body' in value || 'headers' in value)) {
                    // already in the normalized form
                    query = { ...(value.query || {}) };
                    headers = { ...(value.headers || {}) };
                    body = { ...(value.body || {}) };
                } else if (value && typeof value === 'object') {
                    // shorthand form: parse query:xxx / header:xxx
                    Object.entries(value).forEach(([k, v]) => {
                        if (k.startsWith('query:')) {
                            query[k.replace(/^query:/, '')] = v;
                        } else if (k.startsWith('header:')) {
                            headers[k.replace(/^header:/, '')] = v;
                        } else {
                            body[k] = v;
                        }
                    });
                }

                // Only set if doesn't exist or overwrite = true
                if (overwrite || !this.endpoints.has(endpointKey)) {
                    this.endpoints.set(endpointKey, { query, headers, body });
                }
            } else {
                // --- normal data case ---
                if (overwrite || !this.data.has(finalKey)) {
                    this.data.set(finalKey, value);
                }
            }
        });
    }


    /**
     * Get all data as a plain object
     * @param prefix - Optional prefix to filter keys
     * @returns Object containing all data or filtered data
     */
    getAllData(prefix?: string): Record<string, any> {
        const result: Record<string, any> = {};

        for (const [key, value] of this.data.entries()) {
            if (!prefix || key.startsWith(prefix)) {
                // Remove prefix if specified
                const finalKey = prefix ? key.substring(prefix.length + 1) : key;
                result[finalKey] = value;
            }
        }

        return result;
    }

    /**
     * Get all endpoints as a plain object
     * @param prefix - Optional prefix to filter keys
     * @returns Object containing all data or filtered data
     */
    getAllEndpoints(prefix?: string): Record<string, EndpointData> {
        const result: Record<string, any> = {};

        for (const [key, value] of this.endpoints.entries()) {
            if (!prefix || key.startsWith(prefix)) {
                // Remove prefix if specified
                const finalKey = prefix ? key.substring(prefix.length + 1) : key;
                result[finalKey] = value;
            }
        }

        return result;
    }

    /**
     * Get all endpoints as a Map
     * @param prefix - Optional prefix to filter keys
     * @returns Map containing all endpoints or filtered endpoints
     */
    getAllEndpointsMap(prefix?: string): Map<string, EndpointData> {
        const result = new Map<string, EndpointData>();

        for (const [key, value] of this.endpoints.entries()) {
            if (!prefix || key.startsWith(prefix)) {
                // Remove prefix if specified
                const finalKey = prefix ? key.substring(prefix.length + 1) : key;
                result.set(finalKey, value);
            }
        }

        return result;
    }


    /**
     * Check if a key exists in memory
     * @param key - Key to check
     * @returns boolean indicating if key exists
     */
    hasData(key: string): boolean {
        return this.data.has(key);
    }

    /**
     * Get the size of stored data
     * @returns Number of items in memory
     */
    getSize(): number {
        return this.data.size;
    }

    /**
     * Get all keys currently stored
     * @param prefix - Optional prefix to filter keys
     * @returns Array of keys
     */
    getKeys(prefix?: string): string[] {
        if (prefix) {
            return Array.from(this.data.keys()).filter(key => key.startsWith(prefix));
        }
        return Array.from(this.data.keys());
    }
}

const dataMemory = new DataMemory();
export { dataMemory };