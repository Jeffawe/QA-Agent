import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import compression from 'compression';
import helmet from 'helmet';
import { Worker } from 'worker_threads';

import { MiniAgentConfig } from './types.js';
import { checkUserKey } from './externalCall.js';
import { getAgents } from './agentConfig.js';

import { clearSessions, deleteSession, getSession, getSessions, getSessionSize, hasSession, setSession } from './services/memory/sessionMemory.js';
import { clearSessionApiKeys, deleteSessionApiKey, getApiKeyForAgent, storeSessionApiKey } from './services/memory/apiMemory.js';
import { LogManager } from './utility/logManager.js';
import { ParentWebSocketServer } from './services/events/parentWebSocket.js';
import { createServer } from 'http';
import testRoutes from './test/testAgent.js'
import { WorkerPool } from './workerPool.js';
import SegfaultHandler from 'segfault-handler';
SegfaultHandler.registerHandler('crash.log');

dotenv.config();

const app = express();
const server = createServer(app);

// Referer validation middleware to replace CORS
const validateReferer = (req: Request, res: Response, next: express.NextFunction): void => {
    if (req.path === '/health') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        return next();
    }

    const allowedOrigins =
        process.env.NODE_ENV === 'production'
            ? ['https://www.qa-agent.site', 'https://qa-agent.site'] // support both
            : true;

    const referer = req.get('Referer');
    const origin = req.get('Origin');
    const requestOrigin = origin || (referer ? new URL(referer).origin : null);

    // Allow no-origin requests in dev
    if (!requestOrigin && process.env.NODE_ENV !== 'production') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        return next();
    }

    if (allowedOrigins === true || allowedOrigins.includes(requestOrigin || '')) {
        res.header('Access-Control-Allow-Origin', requestOrigin || '*');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }

        return next();
    }

    console.log('❌ Access blocked:', requestOrigin);
    res.status(403).json({
        error: 'Access denied',
        message: 'Origin not allowed'
    });
};


// Replace your CORS configuration with this:
app.use(validateReferer);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// Compression middleware
app.use(compression());

// Body parsing with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// General rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // limit each IP to 300 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again soon.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip successful requests for static files
    skip: (req) => req.url.startsWith('/static') || req.url.startsWith('/public')
});


// Slow down repeated requests (progressive delay)
const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 50, // allow 50 requests per 15 minutes at full speed
    delayMs: () => 500,// slow down subsequent requests by 500ms per request
    maxDelayMs: 20000 // maximum delay of 20 seconds
});

// Apply rate limiting
app.use(generalLimiter);
app.use(speedLimiter);

// Trust proxy (important for Render/Heroku/etc)
app.set('trust proxy', 1);

const PORT: number = parseInt(process.env.PORT || '3001');
let parentWSS: ParentWebSocketServer | null = null;
const agentConfigCache = new Map<string, MiniAgentConfig[]>();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use("/testing", testRoutes);

const cleanup = async () => {
    if (getSessionSize() === 0) {
        console.log('No active sessions to stop.');
        return;
    }
    for (const session of getSessions().values()) {
        if (session.worker) {
            session.worker.postMessage({ command: 'stop' });

            // Force terminate after timeout
            setTimeout(() => {
                session.worker?.terminate();
            }, 5000);
        }
    }

    clearSessions();
    clearSessionApiKeys();

    console.log('All sessions stopped successfully.');
}

// Sets up the worker events and returns the websocket port
const setUpWorkerEvents = (worker: Worker, sessionId: string, goal: string, serializableConfigs: MiniAgentConfig[]): Promise<number> => {
    return new Promise((resolve, reject) => {
        let resolved = false;
        let messageListener: ((message: any) => void) | null = null;
        let errorListener: ((error: Error) => void) | null = null;

        const cleanup = () => {
            if (messageListener) worker.removeListener('message', messageListener);
            if (errorListener) worker.removeListener('error', errorListener);
        };

        // Set up timeout
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                cleanup();
                console.error(`❌ Worker initialization timeout for session ${sessionId}`);
                reject(new Error('Worker initialization timeout'));
            }
        }, 80000);

        const resolveOnce = (port: number) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                cleanup();
                resolve(port);
            }
        };

        const rejectOnce = (error: Error) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                cleanup();
                reject(error);
            }
        };

        messageListener = (message: any) => {
            switch (message.type) {
                case 'initialized':
                    if (message.websocketPort && typeof message.websocketPort === 'number') {
                        resolveOnce(message.websocketPort);
                    } else {
                        rejectOnce(new Error('Worker initialized but no valid websocket port received'));
                    }
                    break;

                case 'session_cleanup':
                    console.log(`🧹 Received cleanup request for session ${message.sessionId}`);
                    deleteSession(message.sessionId);
                    deleteSessionApiKey(message.sessionId);
                    break;

                case 'error':
                    const errorMsg = message.error || 'Unknown worker error';
                    console.error(`❌ Agent error for session ${sessionId}:`, errorMsg);
                    rejectOnce(new Error(`Worker initialization error: ${errorMsg}`));
                    break;

                case 'log':
                    console.log(`🔍 Worker log for session ${sessionId}:`, message.message);
                    break;
            }
        };

        errorListener = (error: Error) => {
            console.error(`💥 Worker error for session ${sessionId}:`, error);
            rejectOnce(new Error(`Worker error: ${error.message}`));

            try {
                worker.postMessage({ command: 'stop' });
            } catch (stopError) {
                console.error(`Failed to send stop command to worker ${sessionId}:`, stopError);
            }
        };

        worker.on('message', messageListener);
        worker.on('error', errorListener);

        worker.on('exit', (code) => {
            console.log(`🚪 Worker ${sessionId} exited with code ${code}`);
            deleteSession(sessionId);

            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                cleanup();
                reject(new Error(`Worker exited prematurely with code ${code}`));
            }
        });

        // Validate and send data
        const apiKey = getApiKeyForAgent(sessionId) ?? process.env.API_KEY;
        if (!apiKey) {
            rejectOnce(new Error('No API key available for session'));
            return;
        }

        if (!serializableConfigs || serializableConfigs.length === 0) {
            rejectOnce(new Error('No agent configurations provided'));
            return;
        }

        try {
            worker.postMessage({
                command: 'start',
                agentConfig: {
                    sessionId,
                    apiKey,
                    goalValue: goal,
                    agentConfigs: serializableConfigs
                }
            });
        } catch (postError) {
            rejectOnce(new Error(`Failed to send start command to worker: ${postError}`));
        }
    });
};

const setupWSS = async (): Promise<ParentWebSocketServer> => {
    try {
        if (parentWSS) return parentWSS; // reuse

        parentWSS = new ParentWebSocketServer(server, PORT);

        await parentWSS.waitForReady();
        console.log(`✅ WebSocket server is ready at port ${PORT}`);
        return parentWSS;
    } catch (error) {
        console.error('❌ WebSocket server setup error:', error);
        throw error;
    }
};

async function getCachedAgents(goal: string, detailed: boolean): Promise<MiniAgentConfig[]> {
    const cacheKey = `${goal}_${detailed}`;

    if (agentConfigCache.has(cacheKey)) {
        console.log('⚡ Using cached agent configuration');
        return agentConfigCache.get(cacheKey)!;
    }

    const agents = await getAgents(goal, detailed);
    const serializableConfigs: MiniAgentConfig[] = Array.from(agents).map(config => ({
        name: config.name,
        sessionType: config.sessionType,
        dependent: config.dependent,
        agentDependencies: config.agentDependencies,
    }));

    agentConfigCache.set(cacheKey, serializableConfigs);
    console.log('💾 Agent configuration cached');
    return serializableConfigs;
}

app.get('/', (req: Request, res: Response) => {
    res.send('Welcome to QA-Agent! Go to https://www.qa-agent.site/ for more info.');
});

app.get('/health', (req: Request, res: Response) => {
    const message = 'Server is running fine!';
    const data = `Running ${getSessionSize()} sessions which are ${Array.from(getSessions().keys()).join(', ')}`;
    res.send({ message, data });
});

app.get('/start', (req: Request, res: Response) => {
    try {
        if (getSessionSize() >= parseInt(process.env.MAX_SESSIONS ?? '10')) {
            res.status(429).send('We have reached the maximum number of sessions. Try again another time');
        }

        const sessionId = uuidv4();
        res.json({ sessionId });

    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }
});

app.post('/start/:sessionId', async (req: Request, res: Response) => {
    const { goal, url, data } = req.body;
    const sessionId = req.params.sessionId;

    if (getSessionSize() >= parseInt(process.env.MAX_SESSIONS ?? '10')) {
        res.status(429).send('We have reached the maximum number of sessions. Try again another time');
        return;
    }

    if (hasSession(sessionId)) {
        console.log('Session already started.');
        res.status(400).send('Session already started.');
        return;
    }

    if (!goal) {
        console.log('USER_GOAL is not set. Please set the USER_GOAL environment variable.');
        res.status(500).send('USER_GOAL is not set. Please set the USER_GOAL environment variable.');
        return;
    }

    try {
        if (!parentWSS) {
            throw new Error('WebSocket server not initialized');
        }

        const detailed = data['detailed'] || false;

        // PARALLEL EXECUTION: Start both operations simultaneously
        const [serializableConfigs] = await Promise.all([
            getCachedAgents(goal, detailed)
        ]);

        // Use worker pool for faster startup
        const workerPool = WorkerPool.getInstance();
        const worker = workerPool.getWorker(sessionId, url, data);

        const websocketPort: number = await Promise.race([
            setUpWorkerEvents(worker, sessionId, goal, serializableConfigs),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Worker initialization timeout")), 30000)
            )
        ]);

        setSession(sessionId, {
            worker,
            status: 'running',
            websocketPort: websocketPort
        });

        console.log(`⚡ Session ${sessionId} started successfully in optimized mode!`);

        res.json({
            message: `Session ${sessionId} started successfully!`,
            sessionId: sessionId,
            websocketport: websocketPort || 8080
        });
    } catch (error) {
        console.error(`❌ Error starting session ${sessionId}:`, error);

        if (hasSession(sessionId)) {
            try {
                const session = getSession(sessionId);
                if (session) {
                    session.worker.postMessage({ command: 'stop' });
                    setTimeout(() => {
                        console.log(`⏰ Force terminating stuck worker ${sessionId}`);
                        session.worker?.terminate();
                        deleteSession(sessionId);
                    }, 5000); // Reduced from 10s to 5s
                }
                console.log(`🧹 Worker terminated for failed session ${sessionId}`);
            } catch (terminateError) {
                console.error(`Error terminating worker for session ${sessionId}:`, terminateError);
            }
        }

        if (error instanceof Error && error.message.includes('timeout')) {
            res.status(408).json('The session took too long to initialize. Please try again.');
        } else {
            res.status(500).json(error instanceof Error ? error.message : 'Unknown error occurred');
        }
    }
});

app.get('/stop/:sessionId', async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    console.log(`🔄 Attempting to stop session: ${sessionId}`);

    try {
        const session = getSession(sessionId);

        if (!session) {
            console.log(`❌ Session ${sessionId} not found.`);
            res.send('Session not found.');
            return;
        }

        if (session.worker) {
            session.worker.postMessage({ command: 'stop' });

            setTimeout(() => {
                console.log(`⏰ Force terminating stuck worker ${sessionId}`);
                session.worker?.terminate();
                deleteSession(sessionId);
            }, 10000);
        }

        console.log(`✅ Session ${sessionId} stopped successfully.`);
        res.send('Session stopped successfully!');
    } catch (error) {
        const err = error as Error;
        console.error(`💥 Error stopping session ${sessionId}:`, error);
        res.status(500).send(`Failed to stop session: ${err.message}`);
    }
});

app.get('/stop', async (req: Request, res: Response) => {
    try {
        if (getSessionSize() === 0) {
            console.log('No active sessions to stop.');
            res.status(404).send('No active sessions to stop.');
            return;
        }

        for (const session of getSessions().values()) {
            if (session.worker) {
                session.worker.postMessage({ command: 'stop' });
            }
        }

        clearSessions();
        clearSessionApiKeys();
        LogManager.deleteAllLogFiles();

        console.log('All sessions stopped successfully.');
        res.send('All sessions stopped successfully!');
        setTimeout(() => process.exit(0), 100);
    } catch (error) {
        console.error('Error stopping sessions:', error);
        res.status(500).send('Failed to stop sessions.');
        setTimeout(() => process.exit(1), 100);
    }
})

app.post('/test/:key', async (req: Request, res: Response) => {
    const { goal, url, data } = req.body;
    const key = req.params.key;
    const sessionId = "test_" + key;

    if (getSessionSize() >= parseInt(process.env.MAX_SESSIONS ?? '10')) {
        res.status(429).send('We have reached the maximum number of sessions. Try again another time');
        return;
    }

    if (hasSession(sessionId)) {
        console.log('Test Session already started.');
        res.status(400).send('Test Session already started.');
        return;
    }

    try {
        if (!parentWSS) {
            throw new Error('WebSocket server not initialized');
        }
        // PARALLEL EXECUTION: Run key validation and config loading simultaneously
        const getKey: boolean = process.env.NODE_ENV === 'production';
        const detailed = data['detailed'] || false;

        const [keyValidationSuccess, serializableConfigs] = await Promise.all([
            checkUserKey(sessionId, key, getKey).catch(() => false),
            getCachedAgents(goal, detailed)
        ]);

        if (!keyValidationSuccess) {
            res.status(401).send('Unauthorized');
            return;
        }

        if (!goal) {
            res.status(500).send('USER_GOAL is not set. Please set the USER_GOAL environment variable.');
            return;
        }

        const workerPool = WorkerPool.getInstance();
        const worker = workerPool.getWorker(sessionId, url, data);

        const websocketPort: number = await Promise.race([
            setUpWorkerEvents(worker, sessionId, goal, serializableConfigs),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Worker initialization timeout")), 30000)
            )
        ]);

        setSession(sessionId, {
            worker,
            status: 'running',
            websocketPort: websocketPort
        });

        console.log(`⚡ Starting Test Session: ${sessionId} (optimized)`);

        res.json({
            message: `Test Session started successfully!`,
            sessionId: sessionId,
            websocketport: websocketPort || 8080
        });
    } catch (error) {
        console.error(`❌ Error starting session ${sessionId}:`, error);

        if (hasSession(sessionId)) {
            try {
                const session = getSession(sessionId);
                if (session) {
                    session.worker.postMessage({ command: 'stop' });
                    setTimeout(() => {
                        console.log(`⏰ Force terminating stuck worker ${sessionId}`);
                        session.worker?.terminate();
                        deleteSession(sessionId);
                    }, 5000);
                }
                console.log(`🧹 Worker terminated for failed session ${sessionId}`);
            } catch (terminateError) {
                console.error(`Error terminating worker for session ${sessionId}:`, terminateError);
            }
        }

        if (error instanceof Error && error.message.includes('timeout')) {
            res.status(408).json({
                error: 'Session initialization timeout',
                message: 'The session took too long to initialize. Please try again.'
            });
        } else {
            res.status(500).json({
                error: 'Failed to start session',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        }
    }
});

app.get('/status/:sessionId', async (req: Request, res: Response) => {
    try {
        const sessionId = req.params.sessionId;

        if (hasSession(sessionId)) {
            res.json({ "active": true })
        } else {
            res.json({ "active": false })
        }
    } catch (error) {
        console.error('Error stopping sessions:', error);
        res.status(500).send('Failed to stop sessions.');
        setTimeout(() => process.exit(1), 100);
    }
});

// Endpoint to receive and encrypt API key
app.post('/setup-key/:sessionId', (req: Request, res: Response) => {
    try {
        const { apiKey, testKey } = req.body;
        const { sessionId } = req.params;

        let newApiKey = apiKey;

        if (!apiKey) {
            res.status(400).json({ error: 'API key is required' });
            return;
        }

        if (!sessionId) {
            res.status(400).json({ error: 'Session ID is required' });
            return;
        }

        if (testKey && apiKey.startsWith('TEST') && testKey == process.env.TEST_KEY) {
            console.log('Test API key received');
            newApiKey = process.env.TEST_API_KEY;
        }

        // Store encrypted key mapped to sessionId
        storeSessionApiKey(sessionId, newApiKey ?? apiKey);

        console.log(`🔑 API key stored for session ${sessionId}`);

        res.json({
            success: true,
            message: 'API key stored securely',
            sessionId
        });

    } catch (error) {
        console.error('❌ Error storing API key:', error);
        res.status(500).json({ error: 'Failed to store API key' });
    }
});

server.listen(PORT, '0.0.0.0', async () => {
    try {
        await Promise.all([
            setupWSS(),
            Promise.resolve(WorkerPool.getInstance()) // Initialize worker pool
        ]);
        console.log(`🚀 Server listening on port ${PORT} on all interfaces`);
    } catch (err) {
        console.error("❌ Failed to set up WSS:", err);
        // Decide: do you want to exit, or keep running HTTP only?
        process.exit(1); // force exit if WS is critical
    }
});


process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    cleanup();
    WorkerPool.getInstance().shutdown();
    process.exit(0);
});

const memoryCheck = setInterval(() => {
    const mem = process.memoryUsage();

    if (mem.heapUsed > 450 * 1024 * 1024) {
        console.error('Memory limit reached - restarting');
        cleanup();
        WorkerPool.getInstance().shutdown();
        process.exit(1); // Let Render restart the instance
    }
}, 100000);

process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received, shutting down...');
    cleanup();
    WorkerPool.getInstance().shutdown();
    process.exit(0);
});

// Classify (fails?) → LLM Classify → Generate Test Data → Test Them
//      ↓
// Generate Test Data (fails?) → LLM Generate Test Data → Test Them