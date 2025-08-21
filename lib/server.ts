import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { MiniAgentConfig, State } from './types.js';
import { checkUserKey } from './externalCall.js';
import { getAgents } from './agentConfig.js';

import { clearSessions, deleteSession, getSession, getSessions, getSessionSize, hasSession, setSession } from './services/memory/sessionMemory.js';
import { clearSessionApiKeys, deleteSessionApiKey, getApiKeyForAgent, storeSessionApiKey } from './services/memory/apiMemory.js';
import { LogManager } from './utility/logManager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const allowedOrigins = process.env.NODE_ENV === 'production'
    ? ['https://www.qa-agent.site']
    : true; // Allow all in development

// const allowedOrigins = process.env.NODE_ENV === 'production'
//     ? true
//     : true; // Allow all in development

app.use(cors({
    origin: function (origin, callback) {
        console.log('🔍 Incoming origin:', origin);
        console.log('🔍 Allowed origins:', allowedOrigins);
        console.log('🔍 NODE_ENV:', process.env.NODE_ENV);
        
        if (!origin) {
            // Allow requests with no origin (like mobile apps, Postman, etc.)
            return callback(null, true);
        }
        
        if (allowedOrigins === true || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log('❌ CORS blocked:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

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
    windowMs: 30 * 60 * 1000, // 15 minutes
    max: 50, // limit each IP to 10 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip successful requests for static files
    skip: (req) => req.url.startsWith('/static') || req.url.startsWith('/public')
});

// API rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, // Higher limit for API endpoints
    message: {
        error: 'API rate limit exceeded, please try again later.',
        retryAfter: '15 minutes'
    }
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

// Apply API rate limiting to API routes
app.use(apiLimiter);

// Trust proxy (important for Render/Heroku/etc)
app.set('trust proxy', 1);

const PORT: number = parseInt(process.env.PORT || '3001');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

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
        const timeout = setTimeout(() => {
            reject(new Error('Worker initialization timeout'));
        }, 10000);

        const messageHandler = (message: any) => {
            switch (message.type) {
                case 'initialized':
                    if (!resolved) {
                        clearTimeout(timeout);
                        resolved = true;
                        resolve(message.websocketPort);
                    }
                    break;

                case 'session_cleanup':
                    console.log(`Received cleanup request for session ${message.sessionId}`);
                    deleteSession(message.sessionId);
                    deleteSessionApiKey(message.sessionId);
                    break;

                case 'error':
                    console.error(`Agent error for session ${sessionId}:`, message.error);
                    if (!resolved) {
                        clearTimeout(timeout);
                        resolved = true;
                        reject(new Error(`Worker initialization error: ${message.error}`));
                    }
                    break;
            }
        };

        let resolved = false;

        worker.on('message', messageHandler);

        worker.on('error', (error) => {
            console.error(`Worker error for session ${sessionId}:`, error);
            if (!resolved) {
                clearTimeout(timeout);
                resolved = true;
                reject(error);
            }
            worker.postMessage({ command: 'stop' });
        });

        worker.on('exit', (code) => {
            console.log(`Worker ${sessionId} exited with code ${code}`);
            deleteSession(sessionId);
        });

        // Send the start command
        worker.postMessage({
            command: 'start',
            agentConfig: {
                sessionId,
                apiKey: getApiKeyForAgent(sessionId),
                goalValue: goal,
                agentConfigs: serializableConfigs
            }
        });
    });
};

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
    const { goal, url } = req.body;
    const sessionId = req.params.sessionId;

    if (getSessionSize() >= parseInt(process.env.MAX_SESSIONS ?? '10')) {
        res.status(429).send('We have reached the maximum number of sessions. Try again another time');
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
        const agents = await getAgents(goal);
        const serializableConfigs: MiniAgentConfig[] = Array.from(agents).map(config => ({
            name: config.name,
            sessionType: config.sessionType,
            dependent: config.dependent,
            agentDependencies: config.agentDependencies,
        }));

        const worker = new Worker(join(__dirname, 'agent-worker.js'), {
            workerData: { sessionId, url }
        });

        const websocketPort = await setUpWorkerEvents(worker, sessionId, goal, serializableConfigs);

        setSession(sessionId, {
            worker,
            status: 'starting'
        });

        console.log(`Session ${sessionId} started successfully!`);

        res.json({
            message: `Session ${sessionId} started successfully!`,
            sessionId: sessionId,
            websocketport: websocketPort
        });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }
});

app.get('/stop/:sessionId', async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    console.log(`🔄 Attempting to stop session: ${sessionId}`);

    try {
        const session = getSession(sessionId);

        if (!session) {
            console.log(`❌ Session ${sessionId} not found.`);
            res.status(404).send('Session not found.');
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
    const { goal, url } = req.body;
    const key = req.params.key;
    const sessionId = "test_" + key;

    if (getSessionSize() >= parseInt(process.env.MAX_SESSIONS ?? '10')) {
        res.status(429).send('We have reached the maximum number of sessions. Try again another time');
    }

    if (hasSession(sessionId)) {
        console.log('Test Session already started.');
        res.status(400).send('Test Session already started.');
        return;
    }

    try {
        const getKey: boolean = process.env.NODE_ENV === 'production'
        const success = await checkUserKey(sessionId, key, getKey);
        if (!success) {
            res.status(401).send('Unauthorized');
            return;
        }

        if (!goal) {
            res.status(500).send('USER_GOAL is not set. Please set the USER_GOAL environment variable.');
            return;
        }

        const agents = await getAgents(goal);
        const serializableConfigs: MiniAgentConfig[] = Array.from(agents).map(config => ({
            name: config.name,
            sessionType: config.sessionType,
            dependent: config.dependent,
            agentDependencies: config.agentDependencies,
        }));

        const worker = new Worker(join(__dirname, 'agent-worker.js'), {
            workerData: { sessionId, url }
        });

        const websocketPort = await setUpWorkerEvents(worker, sessionId, goal, serializableConfigs);

        setSession(sessionId, {
            worker,
            status: 'starting'
        });

        console.log(`Starting Test Session: ${sessionId}`);

        res.json({
            message: `Test Session started successfully!`,
            sessionId: sessionId,
            websocketport: websocketPort
        });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).send('Failed to start session.');
    }
});

// Endpoint to receive and encrypt API key
app.post('/setup-key/:sessionId', (req: Request, res: Response) => {
    try {
        const { apiKey } = req.body;
        const { sessionId } = req.params;

        if (!apiKey) {
            res.status(400).json({ error: 'API key is required' });
            return;
        }

        if (!sessionId) {
            res.status(400).json({ error: 'Session ID is required' });
            return;
        }

        // Store encrypted key mapped to sessionId
        storeSessionApiKey(sessionId, apiKey);

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

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received, shutting down...');
    cleanup();
    process.exit(0);
});

// Classify (fails?) → LLM Classify → Generate Test Data → Test Them
//      ↓
// Generate Test Data (fails?) → LLM Generate Test Data → Test Them