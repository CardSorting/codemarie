# 🚀 Get Started with BroccoliDB

Welcome to BroccoliDB! This guide will walk you through setting up BroccoliDB for your project, from the CLI to integrating it into your AI agent's reasoning loop.

---

## 📦 Installation

To get started, install BroccoliDB via NPM:

```bash
npm install broccolidb
```

If you want to use the CLI globally or via `npx`, you're all set!

---

## 🛠️ Step 1: Initialize Your Workspace

BroccoliDB is designed to work seamlessly with Git repositories. The quickest way to set up your local context engine is through the CLI.

Run the following in your project root:

```bash
npx broccolidb init
```

**What this does:**
1.  **Analyzes your environment**: Checks for API keys (Gemini/Google) for semantic search.
2.  **Configures `.gitignore`**: Ensures `broccolidb.db` stays local.
3.  **Indexes your repository**: Scans your files and builds the initial Context Graph.
4.  **Integration (Optional)**: Offers to add BroccoliDB to your Claude Desktop configuration for immediate use.

---

## 🧪 Step 2: Check Graph Health

Once initialized, you can view the "density" of your knowledge graph:

```bash
npx broccolidb status
```

This will show you how many nodes (files/concepts) and edges (relationships) have been indexed, as well as identify "Hub Nodes"—the most influential files in your codebase.

---

## 🤖 Step 3: Library Integration

BroccoliDB is more than just a CLI; it's a high-performance persistence engine for your code.

### Basic Setup

```typescript
import { Connection, Workspace } from 'broccolidb';

// 1. Establish a connection to your SQLite file
const conn = new Connection({ dbPath: './broccolidb.db' });
const pool = conn.getPool();

// 2. Initialize a Workspace
const ws = new Workspace(pool, 'my-user-id', 'my-workspace-id');
await ws.init();

// 3. Access a Repository
const repo = await ws.getRepo('my-project-name');
```

### High-Frequency Reasoning (The Brain Pattern)

Use the `BufferedDbPool` (accessed via `pool`) to handle thousands of updates per second with minimal disk latency.

```typescript
// Memory-first update
await pool.push({
  type: 'insert',
  table: 'agent_thoughts',
  values: {
    id: 'thought_1',
    content: 'Analyzing project structure...',
    timestamp: Date.now()
  }
});

// BroccoliDB will automatically flush this to the SQLite disk 
// after a short delay (the Persistence Event Horizon).
```

---

## 🔍 Next Steps

- **[Usage Guide (USAGE.md)](./USAGE.md)**: Detailed API references for Graph traversal, MCP servers, and more.
- **[Tutorial: AI Agents (TUTORIAL_AI_AGENT.md)](./TUTORIAL_AI_AGENT.md)**: A practical guide for integrating BroccoliDB into an autonomous agent loop.
- **[Benchmark (BENCHMARK.md)](./BENCHMARK.md)**: See what happens when you push BroccoliDB to its limits (spoiler: it's fast).

---

## 🥦 Why "Broccoli"?
Because it's good for your (Agent's) brain, it has a fractal structure (like a knowledge graph), and it's hardened against the "junk food" of slow, unoptimized persistence.
