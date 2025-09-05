class DataMemory {
    private data = new Map<string, any>();

    constructor() { }   

    initalize() { }

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
}

const dataMemory = new DataMemory();
export { dataMemory };