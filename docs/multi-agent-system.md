# Multi-Agent System (MAS) Documentation

## Overview
The Multi-Agent System (MAS) is a high-level cognitive orchestration layer designed to handle complex, multi-turn tasks that exceed the capacity of a single agent context. It follows a multi-tiered architecture that balances performance, focus, and deep reasoning.

> [!NOTE]
> This document is part of the [Cognitive Architecture](KNOWLEDGE_BASE_GUIDE) domain. For a deep technical dive, see the [MAS Technical Architecture](hyper-cognition/MAS_ARCHITECTURE).

## Core Architecture

### 1. Orchestration Controller
The `OrchestrationController` is the central hub for MAS activities. It manages:
- **Stream Lifecycle**: Creation and tracking of agent execution streams.
- **Context Persistence**: Integration with BroccoliDB for long-term memory.
- **Cognitive Bus**: A centralized distribution mechanism for system-wide summaries (`StreamDigest`).

### 2. Sub-Agent Systems
MAS is composed of specialized agents that collaborate on a shared task:
- **Ikigai System**: Defines the high-level purpose and scope of the stream.
- **JoyZoning System**: Maps the proposed changes to architectural constraints and potential risks.
- **Kanban System**: Breaks down the scope into a sequence of executable `AgentTask` nodes.
- **Kaizen System**: Provides a continuous refinement loop, evaluating logical soundness and adapting priorities.

## Optimization Tiers

MAS is implemented using a progressive optimization strategy:

### Tier 1-2: Performance & Speculation
- **Memoized Registrations**: Agent identities are cached to eliminate DB overhead.
- **Cog-Parallelism**: Independent agents like `Ikigai` and Graph Self-Healing run in parallel to reduce wait times.

### Tier 3: Grounded Intelligence
- **Intent Grounding**: Intent is first verified by a grounding pass before MAS initiates the plan.
- **Verified Spec**: Validated project entities and constraints are passed as seeds to sub-agents.

### Tier 4: Unified Cognitive Fabric
- **Shared Reasoning Canvas**: Agents can "annotate" existing knowledge nodes, allowing for cross-agent auditing and linked reasoning.
- **Adaptive Reprioritization**: `Kaizen` can dynamically freeze or elevate tasks in the queue based on architectural soundness.
- **Unified Cog-Bus**: Real-time distribution of system context ensuring all agents remain in sync.

### Tier 5: Swarm-Parallel Execution
- **StreamPool**: A semaphore-based concurrency manager that dispatches Kanban tasks to concurrent `WorkerStreams`. Configurable `maxConcurrency` (default: 3) controls how many build agents run simultaneously.
- **WorkerStream**: Each task executes within an isolated child stream with its own DB shadow. Workers perform file collision checks before writes. On success, the shadow is committed; on failure, it is rolled back.
- **StreamCoordinator**: Inter-stream signaling layer managing file-level locks, collision resolution (exponential backoff with jitter), progress aggregation across all active workers, and shutdown coordination.
- **Isolation Guarantee**: Worker failures are isolated — one crashing worker cannot bring down the pool. The parent stream receives aggregated results from all workers.

## Integration & Defaults
- **Default Operation**: MAS is enabled by default (`masEnabled: true`).
- **User Control**: Users can disable MAS in the global settings if single-agent execution is preferred.
- **Sequence**: `User Intent` -> `Grounding` -> `MAS Orchestration` -> `Concurrent Build (StreamPool)` -> `Task Execution`.

## Webview UI Integration

The MAS architecture is not simply a background CLI process—it fundamentally transforms the CodeMarie VS Code Webview UX. A suite of advanced React components in `webview-ui` has been built to surface the multi-agent cognitive process directly to the user:

- **`SubagentStatusRow.tsx`**: Visually renders the real-time execution bounds of orchestrated parallel streams. It displays exactly when the Swarm (`Architect`, `Security`, `UX`) is "running", "completed", or "failed", along with tool usage and cost statistics.
- **`RedTeamAlerts.tsx`**: Renders the adversarial critique payload. This injects a distinct, red-bordered critical warning block into the chat containing the computed `Risk Score` bar metric, isolated `Pitfalls`, and `Recommended Mitigations`.
- **`ClarificationHub.tsx` & `IntentDecomposition.tsx`**: Surfaces the `Ikigai` intent analysis visually, allowing users to interactively clarify ambiguous project scopes before the Kanban planner begins.
- **`ThinkingRow.tsx`**: Captures real-time output from the Cognitive Fabric's internal reasoning engine, giving users a transparent look into how CodeMarie is structurally evaluating the codebase.

## Reference Implementation
- **Controller**: `src/core/orchestration/OrchestrationController.ts`
- **Main Flow**: `src/core/orchestration/MultiAgentStreamSystem.ts`
- **Concurrent Pool**: `src/core/orchestration/StreamPool.ts`
- **Worker Agent**: `src/core/orchestration/WorkerStream.ts`
- **Coordinator**: `src/core/orchestration/StreamCoordinator.ts`
- **Context**: `src/core/broccolidb/agent-context.ts`
- **Webview Rendering**: `webview-ui/src/components/chat/` (`ChatRow.tsx`, `SubagentStatusRow.tsx`, `RedTeamAlerts.tsx`)
