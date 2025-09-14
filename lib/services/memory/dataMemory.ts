class DataMemory {
    private data = new Map<string, any>();

    constructor() { }

    initialize() { }

    clear() {
        this.data.clear();
    }

    setData(key: string, value: any) {
        this.data.set(key, value);
    }

    getData(key: string) {
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
    loadData(dataObject: Record<string, any>, options: { overwrite?: boolean; prefix?: string } = {}) {
        const { overwrite = true, prefix = '' } = options;

        if (!dataObject || typeof dataObject !== 'object') {
            console.warn('DataMemory.loadData: Invalid data object provided');
            return;
        }

        Object.entries(dataObject).forEach(([key, value]) => {
            const finalKey = prefix ? `${prefix}.${key}` : key;

            // Only set if key doesn't exist or overwrite is true
            if (overwrite || !this.data.has(finalKey)) {
                this.data.set(finalKey, value);
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