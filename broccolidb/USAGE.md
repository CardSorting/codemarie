# 🥦 Usage Guide

BroccoliDB is a high-performance persistence engine built around an asynchronous, memory-first approach to SQLite. This guide provides detailed examples of its primary internal modules and integration patterns.

---

## 1. Connection & Data Pool

The foundation of BroccoliDB is the `Connection`. It manages the underlying SQLite pool and provides high-speed, asynchronous data access through the `BufferedDbPool`.

### Setup

```typescript
import { Connection } from 'broccolidb';

const dbPath = './my-database.db';
const conn = new Connection({ dbPath });
const pool = conn.getPool();
```

### High-Frequency Data Operations

BroccoliDB uses an **O(1) memory buffer** to handle data spikes. This is the **Brain** in the "Brain vs. Notebook" strategy.

```typescript
// Fast Insert/Update
await pool.push({
  type: 'insert',
  table: 'agent_logic',
  values: { stepId: '123', status: 'thinking' }
});

// Atomic Increments (Perfect for token trackers)
await pool.push({
  type: 'increment',
  table: 'stats',
  where: { column: 'key', value: 'tokens' },
  values: { value: 100 }
});
```

---

## 2. Workspace & Repository Management

BroccoliDB organizes your data into logical **Workspaces** and **Repositories**.

### Initializing a Workspace

```typescript
import { Workspace } from 'broccolidb';

const ws = new Workspace(pool, 'user-1', 'workspace-main');
await ws.init();
```

### Working with Repositories

```typescript
const repo = await ws.createRepo('my-cool-project');
// or
const existingRepo = await ws.getRepo('my-cool-project');
```

Repositories provide access to:
- **`files()`**: Low-level file-system-like operations.
- **`resolveRef(branch)`**: Graph traversal for a specific branch or commit.
- **`search(query)`**: High-speed keyword and semantic search (if API keys are present).

---

## 3. High-Quality Agent Context

The `AgentContext` is a specialized service designed to supply your LLM with the most relevant codebase state.

```typescript
import { AgentContext } from 'broccolidb';

const ctx = new AgentContext(ws, pool, 'user-1', {
  agentId: 'helper-bot',
  name: 'CodeHelper'
});

// Get context relative to a specific file
const context = await ctx.getContextForFile('main.ts', { 
  depth: 2, 
  includeNeighbors: true 
});
```

---

## 4. MCP Server Integration

BroccoliDB includes a first-class **Model Context Protocol (MCP)** server, making it instantly compatible with tools like Claude Desktop.

### Programmatic MCP Setup

```typescript
import { BroccoliDBMCP } from 'broccolidb';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new BroccoliDBMCP(repo, agentContext);
const transport = new StdioServerTransport();

await server.server.connect(transport);
```

---

## 🛡️ Error Handling

BroccoliDB provides specific error types to help you handle persistence and graph state issues.

```typescript
import { BroccoliError, ConnectionError, GraphError } from 'broccolidb';

try {
  await ws.init();
} catch (e) {
  if (e instanceof ConnectionError) {
    console.error('Check your SQLite patch and permissions!');
  } else if (e instanceof GraphError) {
    console.error('Knowledge graph state is corrupted.');
  }
}
```

---

## 🔍 Advanced Features

### Semantic Search (Gemini/Google)
To enable high-fidelity semantic search, provide your API key via environment variables:

```bash
export GEMINI_API_KEY=your_key_here
```

BroccoliDB's `AiService` will automatically detect the key and switch from basic keyword matching to full vector-based search.

### Graph Traversal

Traverse your knowledge base using the internal graph service:

```typescript
const branches = await repo.getBranches();
const graph = await repo.resolveRef('main');
const hubNodes = await graph.getHubNodes();
```
