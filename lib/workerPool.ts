import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorkerPool {
    private static instance: WorkerPool;
    private availableWorkers: Worker[] = [];
    private readonly poolSize = parseInt(process.env.WORKER_POOL_SIZE || "2");
    
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
            this.createPrewarmedWorker();
        }
    }

    private createPrewarmedWorker(): Worker {
        if (this.availableWorkers.length >= this.poolSize) {
            return null as any; // Pool is full
        }

        const worker = new Worker(join(__dirname, 'agent-worker.js'), {
            workerData: { 
                preWarmed: true,
                // Don't pass sessionId for prewarmed workers
            }
        });

        // Set up error handling
        worker.on('error', (error) => {
            console.error('❌ Pre-warmed worker error:', error);
            this.replaceWorker(worker);
        });

        // Listen for worker ready signal
        worker.once('message', (message) => {
            if (message.type === 'prewarmed_ready') {
                console.log(`✅ Pre-warmed worker ${message.workerId} ready`);
                this.availableWorkers.push(worker);
            }
        });

        // Handle unexpected exit
        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`❌ Pre-warmed worker exited with code ${code}`);
                this.replaceWorker(worker);
            }
        });

        return worker;
    }

    private replaceWorker(failedWorker: Worker) {
        // Remove failed worker from pool
        this.availableWorkers = this.availableWorkers.filter(w => w !== failedWorker);
        
        // Create replacement
        setTimeout(() => {
            this.createPrewarmedWorker();
        }, 1000); // Small delay to avoid rapid recreation
    }

    getWorker(sessionId: string, url: any, data: any): Worker {
        let worker = this.availableWorkers.pop();
        
        if (!worker) {
            console.log('🏭 No pre-warmed worker available, creating new one');
            // Create worker with session data immediately
            worker = new Worker(join(__dirname, 'agent-worker.js'), {
                workerData: { sessionId, url, data, preWarmed: false }
            });
        } else {
            console.log('⚡ Using pre-warmed worker for session:', sessionId);
            
            // Activate the prewarmed worker with session data
            worker.postMessage({
                command: 'activate_session',
                sessionId,
                url,
                data
            });
        }

        // Create replacement worker for pool (async)
        setTimeout(() => {
            this.createPrewarmedWorker();
        }, 100);

        return worker;
    }

    // Method to gracefully shutdown all workers
    public async shutdown() {
        console.log('🛑 Shutting down worker pool...');
        
        const shutdownPromises = this.availableWorkers.map(worker => {
            return new Promise<void>((resolve) => {
                worker.postMessage({ command: 'shutdown' });
                worker.once('exit', () => resolve());
                
                // Force terminate after timeout
                setTimeout(() => {
                    worker.terminate();
                    resolve();
                }, 5000);
            });
        });

        await Promise.all(shutdownPromises);
        this.availableWorkers = [];
        console.log('✅ Worker pool shutdown complete');
    }
}