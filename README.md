# QA Agent

![npm](https://img.shields.io/npm/v/qa-agent)
![license](https://img.shields.io/npm/l/qa-agent)
![build](https://img.shields.io/github/workflow/status/yourusername/qa-agent/CI)

A powerful CLI tool that uses autonomous agents to crawl, analyse, and test the interactive components of any given website or web application. It's designed for developers and QA teams who want an automated assistant to navigate and evaluate webpages for interactivity, functionality, and structural issues. Check out the site at [QA Agent](https://www.qa-agent.site/) for more detailed info and steps

---

## 🚀 Features

- Crawl and map internal website pages  
- Detect and log interactive elements (buttons, forms, links)  
- Automated testing of links and UI components  
- Pluggable architecture with support for LLM analysis  
- CLI-first design for easy integration into dev workflows  

---

## 📦 Installation

You can install the package globally:

```bash
npm install -g qa-agent
```

---

## 🛠️ Usage

Run the agent with your desired configuration:

```bash
agent-run --goal "Test all interactive elements" --url https://example.com --key <GOOGLE_GENAI_API_KEY>
```

You can also use a **config file** instead of passing arguments:

```bash
agent-run --config ./agent.json
```

Example config file (`agent.json`):

```json
{
  "goal": "Test the login functionality",
  "key": "your-api-key",
  "url": "http://localhost:3000",
  "port": 3001,
  "test-mode": false,
  "auto-start": true,
  "detailed": true,
  "headless": true,
  "endpoint": false,
  "data": {
    "additional": "info"
  }
}
```

---

## ⚙️ CLI Arguments

| Flag            | Description                                                                 | Required | Default |
|-----------------|-----------------------------------------------------------------------------|----------|---------|
| `--goal`        | Goal for the QA agent (what to test/achieve)                               | ✅       | -       |
| `--url`         | Base URL of the site to test                                               | ✅       | -       |
| `--key`         | Google GenAI API Key                                                       | ✅       | -       |
| `--port`        | Local server port                                                          | ❌       | 3001    |
| `--config, -c`  | Path to JSON config file                                                   | ❌       | -       |
| `--test-mode`   | Enable test mode (requires key starting with `TEST`)                       | ❌       | false   |
| `--auto-start`  | Automatically start the agent                                              | ❌       | true    |
| `--daemon, -d`  | Run in background (daemon mode)                                            | ❌       | false   |
| `--sessionId`   | Session identifier for multi-run tracking                                  | ❌       | "1"     |
| `--headless`    | Run browser in headless mode                                               | ❌       | false   |
| `--detailed`    | Test **every** UI element across all pages (more exhaustive, slower)       | ❌       | false   |
| `--endpoint`    | Run agent in API endpoint testing mode                                     | ❌       | false   |
| `--autoconnect` | Automatically open the updates dashboard in the browser                    | ❌       | true    |
| `--help, -h`    | Show help message                                                          | ❌       | -       |

---

## 📑 Logs & Monitoring

QA Agent stores logs in the `logs/` directory of your project.

You can inspect logs directly from the CLI:

```bash
agent-run logs            # Show main log
agent-run logs --json     # Output logs in JSON format
agent-run mission         # Show mission log (markdown)
agent-run crawl-map       # Show crawl results (markdown)
agent-run navigation-tree # Show navigation tree (markdown)
agent-run logs-dir        # Show logs directory path
```

Each log may also be session-specific (e.g., `crawl_map_1.md`).

---

## 🧭 Subcommands

- `agent-run run` → Start the agent  
- `agent-run stop` → Stop all running agents  
- `agent-run logs` → View logs  
- `agent-run crawl-map` → View crawl map  
- `agent-run mission` → View mission log  

---

## 🧪 Examples

Run with inline arguments:

```bash
agent-run --goal "Analyze UI usability" --url https://myapp.com --key ABC123
```

Run in **daemon mode**:

```bash
agent-run --goal "Test login" --url http://localhost:3000 --key ABC123 --daemon
```

Run with config file:

```bash
agent-run --config ./agent.json
```

Run in **detailed mode** (tests every button, form, and link):

```bash
agent-run --goal "Deep test of UI components" --url https://app.com --key ABC123 --detailed
```

---

## 📁 Project Structure

```
├── bin/                # CLI entry point
├── dist/               # Compiled agent logic, server, testing modules
├── logs/               # Session logs and results
├── package.json        # NPM metadata
└── README.md           # Project documentation
```

---

## 📄 License

This project is licensed under the Apache License. See the [LICENSE](./LICENSE) file for details.
