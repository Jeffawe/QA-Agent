#!/usr/bin/env node
import minimist from 'minimist';
import { execSync, spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';

// Function to check if a port is available
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    console.log(`🔍 Trying to bind to port ${port}...`);

    server.listen(port, () => {
      server.once('close', () => {
        resolve(true); // Port is available
      });
      server.close();
    });

    server.on('error', (err) => {
      resolve(false); // Port is in use
    });
  });
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

function getPidUsingPort(portNumber) {
  try {
    if (process.platform === 'win32') {
      // netstat output lines like: TCP    0.0.0.0:3001     0.0.0.0:0    LISTENING      1234
      const out = execSync(`netstat -ano | findstr :${portNumber}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      const lines = out.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const m = line.trim().match(/(\d+)$/);
        if (m) return m[1];
      }
      return null;
    } else {
      try {
        // Prefer lsof
        const out = execSync(`lsof -n -iTCP:${portNumber} -sTCP:LISTEN -Fp`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
        const m = out.match(/p(\d+)/);
        if (m) return m[1];
      } catch {
        // fallback to ss (Linux)
        try {
          const out2 = execSync(`ss -ltnp 'sport = :${portNumber}'`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
          const m2 = out2.match(/pid=(\d+),/);
          if (m2) return m2[1];
        } catch {
          return null;
        }
      }
      return null;
    }
  } catch {
    return null;
  }
}

function getCmdlineForPid(pid) {
  try {
    if (process.platform === 'win32') {
      // wmic may be available on older Windows; fallback to tasklist if needed
      const out = execSync(`wmic process where ProcessId=${pid} get CommandLine 2>nul`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      // wmic prints header "CommandLine" then the value
      if (lines.length >= 2) return lines.slice(1).join(' ');
      // fallback: tasklist doesn't give cmdline; return empty
      return '';
    } else {
      return execSync(`ps -p ${pid} -o args=`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    }
  } catch {
    return '';
  }
}

function isOurServerCommand(cmd) {
  if (!cmd) return false;
  const lc = String(cmd).toLowerCase();

  // explicit server entrypoint (built)
  const serverPath = path.join(PROJECT_ROOT, 'dist', 'server.js').toLowerCase();

  // accept a few other heuristics that indicate "our" process:
  // - the agent-run wrapper
  // - the project root (launched from this repo)
  // - an agent config filename
  const heuristics = [
    serverPath,
    'agent-run',
    'qa-agent',
    'agent-config.json',
    PROJECT_ROOT.toLowerCase()
  ];

  return heuristics.some(h => !!h && lc.includes(h));
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
async function waitForServer(port, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const available = await checkPort(port);
      if (!available) {
        return true; // Server is running (port is in use)
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.log(`❌ Error checking port: ${error.message}`);
      return false;
    }
  }

  console.log(`❌ Gave up after ${maxAttempts} attempts`);
  return false;
}

function openUrl(targetUrl) {
  return new Promise((resolve) => {
    try {
      let child;
      if (process.platform === 'darwin') {
        child = spawn('open', [targetUrl], { detached: true, stdio: 'ignore' });
      } else if (process.platform === 'win32') {
        // use cmd start; empty title argument required
        child = spawn('cmd', ['/c', 'start', '', targetUrl], { detached: true, stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [targetUrl], { detached: true, stdio: 'ignore' });
      }
      if (child && typeof child.unref === 'function') child.unref();
      resolve(true);
    } catch (e) {
      resolve(false);
    }
  });
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

const sessionForSubcommand = String(args.sessionid ?? args.sessionId ?? '1');

if (subcommand === 'logs-dir') {
  console.log(`📂 Logs directory: ${LOG_DIR}`);
  process.exit(0);
}

if (subcommand && logFiles[subcommand]) {
  // For certain markdown logs we store per-session files like crawl_map_<session>.md
  const sessionized = new Set(['crawl-map', 'logs', 'navigation-tree', 'mission']);

  let filename = logFiles[subcommand];
  if (sessionized.has(subcommand)) {
    const ext = path.extname(filename);
    const base = filename.slice(0, -ext.length);
    filename = `${base}_${sessionForSubcommand}${ext}`;
  }

  const filePath = path.join(LOG_DIR, filename);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filename}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');

  console.log(`📄 ${filename}:\n`);
  if (args.json) {
    console.log(JSON.stringify({ content }, null, 2));
  } else {
    console.log(content);
  }

  process.exit(0);
}

if (subcommand && !logFiles[subcommand] && subcommand !== 'run' && subcommand !== 'stop') {
  console.error(`❌ Unknown subcommand: "${subcommand}". Run "agent-run --help" for usage.`);
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
const testMode = args['test-mode'] || config['test-mode'] || false;
const autoStart = args['auto-start'] || config['auto-start'] || true;
const daemonMode = args.daemon || args.d || false;
const sessionid = args.sessionid || config.sessionid || null;
const headless = args.headless || config.headless || false;
const detailed = args.detailed || config.detailed || false;
const data = config.data || {};
const endpoint = args.endpoint || config.endpoint || false;
const autoconnect = args.autoconnect !== undefined ? args.autoconnect : (config.autoconnect !== undefined ? config.autoconnect : true);

if (args.help || args.h) {
  console.log(`
    Usage: agent-run [options]

    Options:
      --config, -c     Path to JSON config file
      --goal           Goal for the QA agent (required)
      --key            Google GenAI API key (required)  
      --url            Base URL (required)
      --port           Server port (default: 3001)
      --test-mode      Enable test mode (default: false)
      --auto-start     Automatically start the agent (default: true)
      --help, -h       Show this help message
      --daemon, -d     Run in daemon mode
      --sessionId      Session ID
      --headless       Run browser in headless mode (default: false)
      --detailed       Run in detailed mode. Tests every UI element in every page as well (default: false)
      --endpoint       Boolean value if what is being tested are API endpoints (default: false)
      --autoconnect    Automatically connect to the websocket if available (default: true)

    Logs:
      agent-run logs            Show main agent log
      agent-run logs --json     Show main agent log in JSON format
      agent-run mission         Show mission log in markdown
      agent-run crawl-map       Show crawl map in markdown. The crawl map shows detailed results of the agent's crawl
      agent-run logs-dir        Show logs directory
      agent-run stop            Stop all agents

    Config File Example:
      {
        "goal": "Test the login functionality",
        "key": "your-api-key",
        "url": "http://localhost:3000",
        "port": 3001,
        "test-mode": true,
        "auto-start": true,
        "detailed": true,
        "headless": true,
        "endpoint": false,
        "data": {
          "additional": "info"
        }
      }

    Examples:
      agent-run --config ./agent.json
      agent-run --goal "Test login" --key "api-key" --url "http://localhost:3000"
  `);
  process.exit(0);
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
  console.error('❌ Please provide a --goal argument. Example: agent-run --goal "Test login" --key "api-key" --url "http://localhost:3000"');
  process.exit(1);
}

if (!key) {
  console.error('❌ Please provide a --key argument. Example: agent-run --goal "Test login" --key "api-key" --url "http://localhost:3000"');
  process.exit(1);
}

if (!url) {
  console.error('❌ Please provide a --url argument. Example: agent-run --goal "Test login" --key "api-key" --url "http://localhost:3000"');
  process.exit(1);
}

if (!/^(https?:\/\/)/.test(url)) {
  console.error('❌ Invalid URL format. Please include http:// or https://');
  process.exit(1);
}

// Check if ports are available
console.log('🔍 Checking port availability...');

let existingPid = getPidUsingPort(port);
let hasPortIssues = false;

// const portStatus = await checkPort(port).then(available => ({ main: available }));

// let hasPortIssues = false;

// if (!portStatus.main) {
//   const pid = getPidUsingPort(port);
//   if (pid) {
//     const cmd = getCmdlineForPid(pid);
//     if (isOurServerCommand(cmd)) {
//       console.log(`ℹ️ Port ${port} is already used by agent server (PID: ${pid}). Will reuse existing server.`);
//       try { if (!fs.existsSync(pidFile)) fs.writeFileSync(pidFile, pid); } catch (e) { /* ignore */ }
//     } else {
//       console.error(`❌ Port ${port} is already in use by PID ${pid} (${cmd}). Please choose a different --port.`);
//       hasPortIssues = true;
//     }
//   } else {
//     console.error(`❌ Port ${port} is already in use. Please choose a different --port.`);
//     hasPortIssues = true;
//   }
// }

// if (hasPortIssues) {
//   console.error('\n💡 Try running with different ports:');
//   console.error(`   agent-run --goal "${goal}" --key "${key}" --url "${url}" --port 3003`);
//   process.exit(1);
// }

// console.log(`✅ Ports ${port} is available.`);

if (existingPid) {
  const cmd = getCmdlineForPid(existingPid);
  if (isOurServerCommand(cmd)) {
    console.log(`ℹ️ Port ${port} is already used by agent server (PID: ${existingPid}). Will reuse existing server.`); try { if (!fs.existsSync(pidFile)) fs.writeFileSync(pidFile, existingPid); } catch (e) { /* ignore */ }
  } else {
    console.error(`❌ Port ${port} is already in use by PID ${existingPid} (${cmd}). Please choose a different --port.`);
    hasPortIssues = true;
  }
}

if (hasPortIssues) {
  console.error('\n💡 Try running with different ports:');
  console.error(`   agent-run --goal "${goal}" --key "${key}" --url "${url}" --port 3003`);
  process.exit(1);
}

if (!existingPid) {
  console.log(`✅ Port ${port} is available.`);
} else {
  console.log(`✅ Will reuse server on port ${port}.`);
}


// Set environment variables
process.env.PORT = String(port);
process.env.API_KEY = key;
process.env.NODE_ENV = 'development';
process.env.HEADLESS = String(headless).toLowerCase();
process.env.WORKER_POOL_SIZE = "1"

console.log('🚀 Starting server...');

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
    console.log(`➡️  Run: curl http://localhost:${port}/test/{test-key} to run in test mode.`);
  }
}

if (daemonMode) {
  console.log('🛠 Starting in daemon mode...');

  const logDir = path.join(PROJECT_ROOT, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

  // If a server is already listening and it's our server, skip starting
  const existingPid = getPidUsingPort(port);
  if (existingPid) {
    const cmd = getCmdlineForPid(existingPid);
    if (isOurServerCommand(cmd)) {
      console.log(`ℹ️ Agent server already running (PID: ${existingPid}), skipping daemon start.`);
      try { if (!fs.existsSync(pidFile)) fs.writeFileSync(pidFile, existingPid); } catch (e) { /* ignore */ }
      // continue on to auto-start logic without exiting
    } else {
      console.log(`ℹ️ Port ${port} occupied by other process (PID: ${existingPid}). Attempting to start daemon may fail.`);
      execSync(
        `node ${path.join(PROJECT_ROOT, 'dist', 'server.js')} > ${path.join(LOG_DIR, 'daemon.log')} 2>&1 & echo $! > ${pidFile}`
      );
      console.log(`✅ Daemon started (PID saved to ${pidFile})`);
      process.exit(0);
    }
  } else {
    execSync(
      `node ${path.join(PROJECT_ROOT, 'dist', 'server.js')} > ${path.join(LOG_DIR, 'daemon.log')} 2>&1 & echo $! > ${pidFile}`
    );
    console.log(`✅ Daemon started (PID saved to ${pidFile})`);
    process.exit(0);
  }
} else {
  // Non-daemon mode: if the port is already used by our server, skip importing to avoid double-start.
  // we already computed existingPid above; re-evaluate only if you want freshest info.
  if (existingPid) {
    const cmd = getCmdlineForPid(existingPid);
    if (isOurServerCommand(cmd)) {
      console.log(`✅ Reusing existing agent server (PID: ${existingPid}) on http://localhost:${port}`);
      // don't import/start — continue to auto-start logic to call /start or /test
    } else {
      // port is occupied by another process (this branch should have exited earlier), attempt to start otherwise
      console.log('🚀 Starting server (in-process)...');
      await import('../dist/server.js');
      console.log(`✅ Agent server running on http://localhost:${port}`);
    }
  } else {
    console.log('🚀 Starting server (in-process)...');
    await import('../dist/server.js');
    console.log(`✅ Agent server running on http://localhost:${port}`);
  }
}

// Auto-start functionality
if (autoStart) {
  console.log('⏳ Waiting for server to be ready...');

  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds for server to initialize

  try {
    console.log('🚀 Server is ready, auto-starting agent...');

    const sessionId = sessionid ?? '1';

    const finalEndpoint = testMode ? `/test/${key}` : `/start/${sessionId}`;
    const baseUrl = `http://localhost:${port}`;

    // Wait a bit more to ensure server is fully initialized
    await new Promise(resolve => setTimeout(resolve, 2000));

    data['detailed'] = detailed;
    data['endpoint'] = endpoint;

    const requestBody = {
      goal: goal,
      url: url,
      data: data
    };

    const body = JSON.stringify(requestBody);
    const headers = { 'Content-Type': 'application/json' };

    await makeRequest(baseUrl, finalEndpoint, { body, headers });
    const updatesUrl = `https://www.qa-agent.site/updates/#tab=local&port=${port}`;

    if (autoconnect) {
      try {
        const opened = await openUrl(updatesUrl);
        if (!opened) {
          console.log(`🔗 Could not open browser automatically. Please visit: ${updatesUrl}`);
        }
      } catch (e) {
        console.log(`🔗 Could not open browser automatically. Please visit: ${updatesUrl}`);
      }
    } else {
      console.log(`🔗 To monitor progress, visit: ${updatesUrl}`);
    }
  } catch (error) {
    console.error('❌ Server failed to start within expected time.');
    process.exit(1);
  }
}