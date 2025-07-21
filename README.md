# QA Agent

![npm](https://img.shields.io/npm/v/qa-agent)
![license](https://img.shields.io/npm/l/qa-agent)
![build](https://img.shields.io/github/workflow/status/yourusername/qa-agent/CI)

A powerful CLI tool that uses autonomous agents to crawl, analyse, and test the interactive components of any given website or web application. It's designed for developers and QA teams who want an automated assistant to navigate and evaluate webpages for interactivity, functionality, and structural issues. Check out the site at [QA Agent](https://qa-agent-react.vercel.app) for more detailed info and steps

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

And then to start the server
```bash
curl http://localhost:3001/start/1
```


## 🛠️ Usage

Run the agent with your desired configuration:

```bash
agent-run --goal "Test all interactive elements" --url https://example.com --port 3001 --key <GOOGLE_GENAI_API_KEY>
```

### CLI Arguments

| Flag           | Description                              | Required |
|----------------|------------------------------------------|----------|
| `--goal`       | Goal or task for the agent to perform    | ✅       |
| `--url`        | Base URL of the site to test             | ✅       |
| `--port`       | Local server port (default: 3001)        | ❌       |
| `--websocket`  | Local server port (default: 3002)        | ❌       |
| `--key`        | Google GenAI API Key                     | ✅       |

---

## 🧪 Example

```bash
agent-run --goal "Analyze UI usability" --url https://myapp.com --key ABC123
```

---

## 📁 Project Structure

```
├── bin/                # CLI entry point
├── lib/                # Agent logic, server, and testing modules
├── package.json        # NPM metadata
└── README.md           # Project documentation
```

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.