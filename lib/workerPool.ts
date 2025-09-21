import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorkerPool {
    private static instance: WorkerPool;
    private availableWorkers: Worker[] = [];
    private readonly poolSize = parseInt(process.env.WORKER_POOL_SIZE || "2");
    private readyWorkers = 0; // Track ready workers
    private poolReadyPromise: Promise<void>; // Promise for pool readiness
    private resolvePoolReady: (() => void) | null = null;

    private constructor() {
        // Create promise that resolves when pool is ready
        this.poolReadyPromise = new Promise<void>((resolve) => {
            this.resolvePoolReady = resolve;
        });

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
        if( this.readyWorkers >= this.poolSize ) {
            return null as unknown as Worker; // Pool is full
        }

        console.log(`♨️ Spinning up pre-warmed worker (${this.readyWorkers + 1}/${this.poolSize})...`);
        const worker = new Worker(join(__dirname, 'agent-worker.js'), {
            workerData: {
                preWarmed: true,
            }
        });

        worker.on('error', (error) => {
            console.error('❌ Pre-warmed worker error:', error);
            this.replaceWorker(worker);
        });

        // Listen for worker ready signal
        worker.once('message', (message) => {
            if (message.type === 'prewarmed_ready') {
                console.log(`✅ Pre-warmed worker ${message.workerId} ready`);
                this.availableWorkers.push(worker);
                this.readyWorkers++;

                // Check if pool is ready (at least 1 worker ready)
                if (this.readyWorkers >= 1 && this.resolvePoolReady) {
                    console.log(`🏊 Worker pool ready! (${this.readyWorkers}/${this.poolSize} workers)`);
                    this.resolvePoolReady();
                    this.resolvePoolReady = null; // Prevent multiple calls
                }
            }
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`❌ Pre-warmed worker exited with code ${code}`);
                this.readyWorkers = Math.max(0, this.readyWorkers - 1);
                this.replaceWorker(worker);
            }
        });

        return worker;
    }

    private replaceWorker(failedWorker: Worker) {
        this.availableWorkers = this.availableWorkers.filter(w => w !== failedWorker);

        setTimeout(() => {
            this.createPrewarmedWorker();
        }, 1000);
    }

    // NEW: Wait for pool to be ready
    async waitForPoolReady(): Promise<void> {
        await this.poolReadyPromise;
    }

    // NEW: Check if pool has ready workers
    hasReadyWorkers(): boolean {
        return this.availableWorkers.length > 0;
    }

    getWorker(sessionId: string, url: any, data: any): Worker {
        let worker = this.availableWorkers.pop();

        if (!worker) {
            console.log('🏭 No pre-warmed worker available, creating new one');
            worker = new Worker(join(__dirname, 'agent-worker.js'), {
                workerData: { sessionId, url, data, preWarmed: false }
            });
        } else {
            console.log('⚡ Using pre-warmed worker for session:', sessionId);
            this.readyWorkers--;

            worker.postMessage({
                command: 'activate_session',
                sessionId,
                url,
                data
            });
        }

        // Create replacement worker
        setTimeout(() => {
            this.createPrewarmedWorker();
        }, 100);

        return worker;
    }

    // NEW: Get pool stats for debugging
    getStats() {
        return {
            poolSize: this.poolSize,
            availableWorkers: this.availableWorkers.length,
            readyWorkers: this.readyWorkers
        };
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