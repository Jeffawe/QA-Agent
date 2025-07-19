#!/usr/bin/env node
import minimist from 'minimist';
import { execSync } from 'child_process';
import net from 'net';

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

// Check Node.js availability
try {
  execSync('node -v', { stdio: 'ignore' });
} catch {
  console.error('❌ Node.js not found.');
  process.exit(1);
}

// Parse arguments
const args = minimist(process.argv.slice(2));
const goal = args.goal || '';
const port = args.port || 3001;
const key = args.key || '';
const url = args.url || '';
const websocket = args.websocket || 3002;

if (args.help || args.h) {
  console.log(`
    Usage: agent-run --goal "<goal>" --key "<api-key>" --url "<base-url>" [options]

    Options:
      --goal       Goal for the QA agent (required)
      --key        Google GenAI API key (required)  
      --url        Base URL (required)
      --port       Server port (default: 3001)
      --websocket  WebSocket port (default: 3002)
      --help, -h   Show this help message
  `);
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
process.env.GOOGLE_GENAI_API_KEY = key;
process.env.USER_GOAL = goal;
process.env.BASE_URL = url;
process.env.WEBSOCKET_PORT = String(websocket);

console.log('🚀 Starting server...');
console.log(`✅ Agent server running on http://localhost:${port}`);
console.log(`➡️  Run: curl http://localhost:${port}/start/1 to start the agent.`);

// Import and run the actual server
import('../dist/lib/server.js');