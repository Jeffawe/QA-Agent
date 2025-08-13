#!/usr/bin/env node
import minimist from 'minimist';
import { execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';

// Function to check if a port is available
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.listen(port, () => {
      server.once('close', () => {
        resolve(true); // Port is available
      });
      server.close();
    });

    server.on('error', () => {
      resolve(false); // Port is in use
    });
  });
}

// Function to check multiple ports
async function checkPorts(ports) {
  const results = {};

  for (const [name, port] of Object.entries(ports)) {
    results[name] = await checkPort(port);
  }

  return results;
}

// Function to read and parse config file
function readConfigFile(configPath) {
  try {
    if (!fs.existsSync(configPath)) {
      console.error(`❌ Config file not found: ${configPath}`);
      process.exit(1);
    }

    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);

    console.log(`✅ Config loaded from: ${configPath}`);
    return config;
  } catch (error) {
    console.error(`❌ Error reading config file: ${error.message}`);
    process.exit(1);
  }
}

// Function to make HTTP request
async function makeRequest(url, endpoint, options = {}) {
  try {
    const fetch = (await import('node-fetch')).default;
    
    // Default options for POST requests
    const defaultOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };
    
    const response = await fetch(`${url}${endpoint}`, defaultOptions);

    if (response.ok) {
      console.log(`✅ Successfully called ${endpoint}`);
      return await response.text();
    } else {
      console.error(`❌ Failed to call ${endpoint}: ${response.status} ${response.statusText}`);
      return null; // or throw an error
    }
  } catch (error) {
    console.error(`❌ Error calling ${endpoint}: ${error.message}`);
    return null; // or throw an error
  }
}

// Function to wait for server to be ready
async function waitForServer(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const available = await checkPort(port);
      if (!available) {
        return true; // Server is running (port is in use)
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    } catch (error) {
      // Continue trying
    }
  }
  return false;
}

// Check Node.js availability
try {
  execSync('node -v', { stdio: 'ignore' });
} catch {
  console.error('❌ Node.js not found.');
  process.exit(1);
}

// Parse arguments
const args = minimist(process.argv.slice(2));

const subcommand = args._[0];

const PROJECT_ROOT = process.cwd();
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const pidFile = path.join(LOG_DIR, 'daemon.pid');

const logFiles = {
  logs: 'agent.log',
  mission: 'mission_log.md',
  'crawl-map': 'crawl_map.md',
  'navigation-tree': 'navigation_tree.md'
};

if (subcommand === 'logs-dir') {
  console.log(`📂 Logs directory: ${LOG_DIR}`);
  process.exit(0);
}

if (subcommand && logFiles[subcommand]) {
  const filePath = path.join(LOG_DIR, logFiles[subcommand]);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${logFiles[subcommand]}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');

  console.log(`📄 ${logFiles[subcommand]}:\n`);
  if (args.json) {
    console.log(JSON.stringify({ content }, null, 2));
  } else {
    console.log(content);
  }

  process.exit(0);
}

if (subcommand && !logFiles[subcommand] && subcommand !== 'run' && subcommand !== 'stop') {
  console.error(`❌ Unknown subcommand: "${subcommand}"`);
  process.exit(1);
}

let config = {};
if (args.config || args.c) {
  const configPath = args.config || args.c;
  config = readConfigFile(path.resolve(configPath));
}

const goal = args.goal || config.goal || '';
const port = args.port || config.port || 3001;
const key = args.key || config.key || '';
const url = args.url || config.url || '';
const websocket = args.websocket || config.websocket || 3002;
const testMode = args['test-mode'] || config['test-mode'] || false;
const autoStart = args['auto-start'] || config['auto-start'] || true;
const daemonMode = args.daemon || args.d || false;

if (args.help || args.h) {
  console.log(`
    Usage: agent-run [options]

    Options:
      --config, -c     Path to JSON config file
      --goal           Goal for the QA agent (required)
      --key            Google GenAI API key (required)  
      --url            Base URL (required)
      --port           Server port (default: 3001)
      --websocket      WebSocket port (default: 3002)
      --test-mode      Enable test mode (default: false)
      --auto-start     Automatically start the agent (default: true)
      --help, -h       Show this help message
      --daemon, -d     Run in daemon mode

    Logs:
      agent-run logs            Show main agent log
      agent-run logs --json     Show main agent log in JSON format
      agent-run mission         Show mission log in markdown
      agent-run crawl-map       Show crawl map in markdown
      agent-run navigation-tree  Show navigation tree in markdown
      agent-run logs-dir         Show logs directory
      agent-run stop            Stop all agents

    Config File Example:
      {
        "goal": "Test the login functionality",
        "key": "your-api-key",
        "url": "http://localhost:3000",
        "port": 3001,
        "websocket": 3002,
        "test-mode": true,
        "auto-start": true
      }

    Examples:
      agent-run --config ./agent.json
      agent-run --goal "Test login" --key "api-key" --url "http://localhost:3000"
  `);
  process.exit(0);
}

if (port === websocket) {
  console.error('❌ Port and WebSocket port cannot be the same.');
  process.exit(1);
}

if (subcommand === 'stop') {
  console.log('⏳ Stopping agent...');
  const isReady = await waitForServer(port);
  if (!isReady) {
    console.error('❌ Agent is not running.');
    process.exit(1);
  }
  await fetch(`http://localhost:${port}/stop`).catch(() => { });
  if (fs.existsSync(pidFile)) {
    const pid = fs.readFileSync(pidFile, 'utf8').trim();
    try {
      process.kill(pid);
      console.log(`✅ Killed daemon process (PID: ${pid})`);
      fs.unlinkSync(pidFile);
    } catch {
      console.error(`❌ Failed to kill PID ${pid} (may not exist)`);
    }
  } else {
    console.log('ℹ️ No daemon PID file found.');
  }
  process.exit(0);
}


// Validate required arguments
if (!goal) {
  console.error('❌ Please provide a --goal argument.');
  process.exit(1);
}

if (!key) {
  console.error('❌ Please provide a --key argument.');
  process.exit(1);
}

if (!url) {
  console.error('❌ Please provide a --url argument.');
  process.exit(1);
}

if (!/^(https?:\/\/)/.test(url)) {
  console.error('❌ Invalid URL format. Please include http:// or https://');
  process.exit(1);
}

// Check if ports are available
console.log('🔍 Checking port availability...');

const portStatus = await checkPorts({
  main: port,
  websocket: websocket
});

let hasPortIssues = false;

if (!portStatus.main) {
  console.error(`❌ Port ${port} is already in use. Please choose a different --port.`);
  hasPortIssues = true;
}

if (!portStatus.websocket) {
  console.error(`❌ WebSocket port ${websocket} is already in use. Please choose a different --websocket port.`);
  hasPortIssues = true;
}

if (hasPortIssues) {
  console.error('\n💡 Try running with different ports:');
  console.error(`   agent-run --goal "${goal}" --key "${key}" --url "${url}" --port 3003 --websocket 3004`);
  process.exit(1);
}

console.log(`✅ Ports ${port} and ${websocket} are available.`);


// Set environment variables
process.env.PORT = String(port);
process.env.API_KEY = key;
process.env.WEBSOCKET_PORT = String(websocket);
process.env.NODE_ENV = 'development';

console.log('🚀 Starting server...');
console.log(`✅ Agent server running on http://localhost:${port}`);
console.log(`✅ WebSocket server running on ws://localhost:${websocket}`);

if (testMode) {
  if (!key.startsWith('TEST')) {
    console.log('❌ Invalid Test Key inputted.');
    process.exit(1);
  }

  console.log('🧪 Test mode enabled');
}

if (!autoStart) {
  console.log(`➡️  Run: curl http://localhost:${port}/start/1 to start the agent.`);
  console.log(`➡️  Run: curl http://localhost:${port}/stop to stop the agent.`);
  if (testMode) {
    console.log(`➡️  Run: curl http://localhost:${port}/test to run in test mode.`);
  }
}

if (daemonMode) {
  console.log('🛠 Starting in daemon mode...');

  const logDir = path.join(PROJECT_ROOT, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

  const pidFile = path.join(logDir, 'daemon.pid');
  execSync(
    `node ${path.join(PROJECT_ROOT, 'dist', 'server.js')} > ${path.join(LOG_DIR, 'daemon.log')} 2>&1 & echo $! > ${pidFile}`
  );
  console.log(`✅ Daemon started (PID saved to ${pidFile})`);
  process.exit(0);
} else {
  await import('../dist/server.js');
}

// Auto-start functionality
if (autoStart) {
  console.log('⏳ Waiting for server to be ready...');

  const serverReady = await waitForServer(port);

  if (serverReady) {
    console.log('🚀 Server is ready, auto-starting agent...');

    const endpoint = testMode ? `/test/${key}` : '/start/1';
    const baseUrl = `http://localhost:${port}`;

    // Wait a bit more to ensure server is fully initialized
    await new Promise(resolve => setTimeout(resolve, 2000));

    const body = JSON.stringify({ goal: goal, url: url });
    const headers = { 'Content-Type': 'application/json' };

    await makeRequest(baseUrl, endpoint, { body, headers });
  } else {
    console.error('❌ Server failed to start within expected time.');
    process.exit(1);
  }
}