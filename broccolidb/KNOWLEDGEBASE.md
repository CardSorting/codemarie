# 🧠 BroccoliDB Knowledgebase

Welcome to the internal documentation for BroccoliDB. This document provides a deep dive into the architecture, data models, and service patterns that power our high-performance infrastructure.

---

## 📑 Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [The Knowledge Graph](#the-knowledge-graph)
   - [Nodes (Knowledge)](#nodes-knowledge)
   - [Edges (Relationships)](#edges-relationships)
3. [Database Schema Reference](#database-schema-reference)
   - [System Tables](#system-tables)
   - [Domain Tables](#domain-tables)
4. [Performance Internals](#performance-internals)
   - [BufferedDbPool: Batching & Coalescing](#buffereddbpool-batching--coalescing)
   - [SqliteQueue: Hybrid Memory/Disk Strategy](#sqlitequeue-hybrid-memorydisk-strategy)
5. [Service Integrations](#service-integrations)
   - [SpiderService: Structural Analysis](#spiderservice-structural-analysis)
   - [GraphService: Traversal & Consistency](#graphservice-traversal--consistency)
6. [Best Practices](#best-practices)

---

## 🏛️ Core Philosophy

BroccoliDB is built on a two-layer architecture that separates **Real-Time Processing** from **Durable Persistence**. 

### The Layered Model
1. **🧠 Layer 1: Memory (The Engine)**: This is where almost everything happens in real-time — enqueuing, de-duplication, coalescing, and complex query indexing. This in-memory sovereignty is why we achieve millions of operations per second.
2. **💾 Layer 2: SQLite (The Safety Net)**: SQLite acts as a **Durable Checkpoint Layer**. Its job is to periodically record summaries of the work done in memory to ensure you can recover your state after a crash.

### Why this works
Traditional drivers treat SQLite as a real-time engine, hitting the disk per operation. BroccoliDB treats SQLite as a notebook: we think at full speed (RAM), and only write down the results of those thoughts (summaries) every few minutes.

---

## 🧠 The Sovereign Strategy Guide: Working with Layers

To get the most out of BroccoliDB, you must understand how to navigate the relationship between **Real-Time Cognition (RAM)** and **Durable Persistence (SQLite)**.

### 1. When to Trust Layer 1 (Memory)
Use Layer 1 for high-velocity, high-frequency state updates where the cost of a disk write outweighs the value of absolute durability for a single event.
- **AI Agent Telemetry**: Token counts, last-seen timestamps, current reasoning step.
- **Ephemeral State**: Scratchpads, temporary variables, and intermediate graph calculations.
- **Queue Enqueuing**: Absorbing massive bursts of jobs for later processing.

### 2. When to Force Layer 2 (SQLite)
Use `dbPool.flush()` explicitly when you reach a "Critical Consciousness Point"—a moment where data loss would be catastrophic.
- **System Handshakes**: Finalizing a task, committing a financial transaction, or closing a long-running agent session.
- **Authoritative Transitions**: When an agent hands off a result to an external system.

### 3. The Sovereign Volatility Window
BroccoliDB operates with an intentional window of potential data loss (e.g., 5000ms or 1,000 ops).
- **The Tradeoff**: By accepting this window, you gain a **100x–1000x** increase in throughput.
- **Mitigation**: Adjust `flushMs` and `activeBufferSize` based on your risk tolerance. In AI systems, it is often faster to "re-reason" the last 5 seconds of work than to wait 50ms for a disk write every time.

---

## 🏛️ Recovery Sovereignty

Because Layer 1 is the primary engine, BroccoliDB treats **Recovery** as a first-class citizen. 

- **The Warmup**: On restart, use `warmupTable()` to hydrate your memory indexes. This ensures your "Brain" (RAM) is immediately authoritative for its most critical data.
- **Consistency**: Even if the brain is wiped, the notebook (SQLite) remains the immutable anchor. Your system wakes up right where it last "summarized" its thoughts.

---

---

## 🕸️ The Knowledge Graph

At its heart, BroccoliDB is a knowledge graph. We use two primary tables to represent this: `knowledge` and `knowledge_edges`.

### Nodes (Knowledge)
A knowledge item (`KnowledgeBaseItem`) is the atomic unit of the graph. It contains:
- **`type`**: The category of information (e.g., `structural_snapshot`, `telemetry`, `decision`).
- **`content`**: The raw data or visualization (e.g., a Mermaid string).
- **`confidence`**: A scale from `0.0` to `1.0` representing the AI's certainty.
- **`hubScore`**: Automatically managed based on the number of inbound and outbound edges.
- **`metadata`**: Extensible JSON for service-specific structured data.

### Edges (Relationships)
Edges represent semantic or structural links between knowledge items.
- **`sourceId` & `targetId`**: The IDs of the connected nodes.
- **`type`**: The nature of the link (e.g., `references`, `derived_from`, `violates`).
- **`weight`**: The strength of the connection, used for traversal prioritizing.

---

## 📊 Database Schema Reference

### System Tables
| Table | Purpose | Key Columns |
| :--- | :--- | :--- |
| `settings` | Global configuration and feature flags. | `key`, `value` |
| `queue_jobs` | Background tasks awaiting processing. | `status`, `payload`, `runAt` |
| `audit_events` | Immutable log of user and agent actions. | `type`, `userId`, `data` |
| `telemetry` | Usage metrics for LLM calls and performance. | `totalTokens`, `cost`, `modelId` |

### Domain Tables
| Table | Purpose | Key Columns |
| :--- | :--- | :--- |
| `repositories` | Tracked source code repositories. | `repoPath`, `defaultBranch` |
| `branches` | Snapshots of repository states. | `repoPath`, `name`, `head` |
| `files` | Content-addressable storage (CAS) for file versions. | `id` (hash), `content` |
| `decisions` | Documented reasoning steps by AI agents. | `decision`, `rationale` |

---

## ⚙️ Performance Internals

### BufferedDbPool: Batching & Coalescing
The `BufferedDbPool` doesn't just queue operations; it optimizes them.
- **Coalescing**: If multiple updates are pushed for the same record, they are merged into a single final update.
- **Bulk Inserts**: Inserts are grouped by table and type, then executed as a single `INSERT INTO ... VALUES (...), (...);` statement.
- **O(1) Status Indexing**: We maintain `activeIndex` and `inFlightIndex` (Map<string, Set<WriteOp>>). This allows `selectWhere` to retrieve indexed items (like `status: pending`) in constant time, even when the buffer contains millions of ops.
- **Pipelined Correctness**: When performing an in-memory `selectWhere`, the engine applies all pending updates and filters out rows that no longer match the query criteria, ensuring atomic-like consistency for uncommitted data.

### SqliteQueue: Event Horizon Strategy
To achieve zero-latency enqueuing at scale:
1. **1M Slot Circular Buffer**: Jobs are added to a fixed-size array (`pendingMemoryBuffer`) using head/tail pointers. This eliminates $O(N)$ overhead from `shift()` or `splice()`.
2. **Background Persistence**: The buffer is flushed to the `queue_jobs` table asynchronously.
3. **Pipelined Dequeue**: While one batch of jobs is being processed, the queue is already pre-fetching the next batch using the `activeIndex`. This allows for a sustained throughput of **4.4M jobs/sec**.

---

## 🛠️ Service Integrations

### SpiderService: Structural Analysis
The `SpiderService` uses BroccoliDB to store "Structural Snapshots."
- **Serializing Graphs**: It converts a complex code-relationship graph into a serialized string for storage in the `knowledge` table.
- **Bootstrap Cache**: It uses the `knowledge` table to store a "warm" cache of the project structure, allowing for sub-second re-initialization on large codebases.

### GraphService: Traversal & Consistency
The `GraphService` provides high-level APIs for interacting with the knowledge graph.
- **BFS Traversal**: Provides breadth-first search through nodes based on edge types and weights.
- **Centrality Calculation**: Uses `inboundEdges` and `outboundEdges` to determine the "Hub Score" of a node, helping agents identify critical pieces of information.
- **Knowledge Merging**: Specifically handles the merging of two nodes while preserving edge relationships.

---

## 🏛️ Advanced Service Patterns (Expert Level)
---

## 🏛️ Sovereign Mind: Technical FAQ

### 1. "How do I know my data is safe?"
Data safety in BroccoliDB is managed by the **Persistence Event Horizon**.
- **The Guarantee**: Once `dbPool.flush()` resolves, your data is durably stored in SQLite's WAL (Write-Ahead Log).
- **The Risk**: Data in the "active buffer" is volatile. We mitigate this by using a **Hybrid Flush Policy** (Time + Size). Even under light load, the system syncs every few seconds.

### 2. "Is SQLite a bottleneck for 4.4M ops/sec?"
**No, because SQLite isn't doing 4.4M ops.**
- BroccoliDB performs **Active Thought Collapsing** in RAM. 
- 1,000,000 enqueues are collapsed into 1–3 physical synchronous disk transactions. 
- SQLite is only ever performing **Massive Batch Checkpoints**, which it is exceptionally good at (~100k rows/sec in WAL mode).

### 3. "What happens if a Warmup fails?"
If `warmupTable()` fails (e.g., corrupted DB), BroccoliDB enters **Cold Operation Mode**.
- It will still function, but queries will hit the disk ($O(N)$) until the memory indexes are naturally rebuilt by new activity.
- We recommend `PRAGMA integrity_check` on startup for high-stakes environments.

### 4. "Can I disable Layer 2 (SQLite) entirely?"
**Yes.** By setting `persistence: false` (or just not initializing the provider), BroccoliDB becomes a pure in-memory engine. However, you lose the **Sovereign Recovery** benefits.

---

*Sovereign Level Documentation — Level 10 Completion — March 2026*
For power users building sovereign AI agents, these advanced services provide the logic layer on top of BroccoliDB's raw storage.

### `ReasoningService`: The "Truth" Layer
The `ReasoningService` is responsible for epistemic evaluation and contradiction detection.
- **`verifySovereignty(nodeId)`**: Uses age decay, churn, and evidence discounting to calculate a node's probability of being "true" in the current repository state.
- **`detectContradictions(startIds, depth)`**: Performs a multi-hop BFS traversal looking for nodes connected by `contradicts` edges.
- **`getReasoningPedigree(nodeId)`**: Recovers the "lineage" of a fact, showing which supporting nodes were used to derive the current belief.
- **`selfHealGraph()`**: Runs a **HITS-like algorithm** (Hubs and Authorities) across the entire graph to prune weak or disconnected nodes.

### `AuditService`: Structural & Logical Governance
The `AuditService` ensures the database and codebase remain in a healthy state.
- **`checkConstitutionalViolation()`**: Audits code changes against a set of "Constitutional Rules" using the AI service.
- **`addLogicalConstraint(pattern, knowledgeId)`**: Adds a blocking or warning constraint that prevents agents from violating established project patterns.
- **`predictEffect(kbId)`**: Simulates the impact of adding a new piece of knowledge, detecting if it would cause contradictions in the graph before it is ever committed.

### `SpiderService`: Structural Entropy Analysis
The `SpiderService` manages the structural health of the repository.
- **`auditStructure()`**: Computes the **Structural Entropy** of the codebase, tracking depth, naming, and coupling.
- **`bootstrapGraph()`**: Uses a specialized high-speed cache (`structural_snapshot`) in the `knowledge` table to re-initialize the graph analyze across thousands of files in sub-second time.

---

## 📜 Best Practices (Expert Only)

---

*Last Updated: March 2026*
