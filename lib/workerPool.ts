import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorkerPool {
    private static instance: WorkerPool;
    private availableWorkers: Worker[] = [];
    private readonly poolSize = parseInt(process.env.WORKER_POOL_SIZE || "2"); // Adjust based on expected concurrent sessions
    
    private constructor() {
        this.preWarmPool();
    }
    
    static getInstance(): WorkerPool {
        if (!WorkerPool.instance) {
            WorkerPool.instance = new WorkerPool();
        }
        return WorkerPool.instance;
    }
    
    private preWarmPool() {
        console.log(`🔥 Pre-warming worker pool with ${this.poolSize} workers...`);
        for (let i = 0; i < this.poolSize; i++) {
            this.createWorker();
        }
    }
    
    private createWorker(): Worker {
        const worker = new Worker(join(__dirname, 'agent-worker.js'), {
            workerData: { preWarmed: true }
        });
        
        worker.on('error', (error) => {
            console.error('Pre-warmed worker error:', error);
            // Remove from pool and create replacement
            this.availableWorkers = this.availableWorkers.filter(w => w !== worker);
            this.createWorker();
        });
        
        return worker;
    }
    
    getWorker(sessionId: string, url: any, data: any): Worker {
        let worker = this.availableWorkers.pop();
        
        if (!worker) {
            console.log('🏭 No pre-warmed worker available, creating new one');
            worker = new Worker(join(__dirname, 'agent-worker.js'), {
                workerData: { sessionId, url, data }
            });
        } else {
            console.log('⚡ Using pre-warmed worker');
            // Update worker data for this session
            worker.postMessage({
                command: 'update_session_data',
                sessionId,
                url,
                data
            });
        }
        
        // Create replacement worker for pool
        setTimeout(() => {
            this.availableWorkers.push(this.createWorker());
        }, 100);
        
        return worker;
    }
}