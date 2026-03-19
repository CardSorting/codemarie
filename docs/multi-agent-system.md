# Multi-Agent System (MAS) Documentation

## Overview
The Multi-Agent System (MAS) is the **Authoritative Orchestration Layer** of CodeMarie. It moves beyond simple task execution to serve as a high-fidelity cognitive guardian, ensuring that every multi-turn mission maintains uncompromising architectural integrity and logical soundness. 

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

### Tier 5: Swarm-Parallel & Recursive Execution
- **StreamPool**: A semaphore-based concurrency manager that dispatches Kanban tasks to concurrent `WorkerStreams`. Configurable `maxConcurrency` (default: 3) controls how many build agents run simultaneously.
- **Wave Approval Governance**: To maintain high-trust during large-scale execution, `StreamPool` implements a **Wave Barrier**. Execution pauses after the planning phase of each wave, requiring explicit user approval via `codemarie.approveWave` before entering the acting phase.
- **WorkerStream**: Each task executes within an isolated child stream with its own DB shadow. Workers perform file collision checks before writes. On success, the shadow is committed; on failure, it is rolled back.
- **Recursive Swarm Architecture**: For massive features, `WorkerStream` can automatically **Self-Decompose**. If a task's plan is too complex (5+ actions), the worker spawns a child `StreamPool` to execute its tasks in parallel, creating a hierarchical swarm tree. 
- **StreamCoordinator**: Inter-stream signaling layer managing file-level locks, collision resolution, progress aggregation, and swarm-wide concurrency.

### Tier 6: The Authoritative Swarm (Autonomous Hardening)
Tier 6 elevates the MAS from a collaborator to a guardian. It introduces:
- **Autonomous Course Correction**: Real-time tracking of **Reflection Adherence**. If an agent ignores "Sticky Insights" from the swarm, the system penalizes the session with `adherenceFailures`, escalating risk and eventually triggering protective measures.
- **Predictive Mission Termination**: A breakthrough safeguard against **Logic Drift**. The MAS monitors the `soundnessTrend` over multiple turns; if soundness consistently declines below unrecoverable thresholds (0.6), the mission is autonomously aborted to prevent workspace corruption.
- **Live Swarm Grafting**: Parallel streams are no longer isolated. Through global BroccoliDB notifications, active missions receive real-time "Global Swarm Updates" when sibling streams reach critical handoff milestones.
- **Deep Semantic Auditing**: The `auditFile` hook is now powered by the **Kaizen System**, providing full semantic validation against project-specific architectural rules for every write.
- **Diagnostic Tool-Doctor**: When tools fail repeatedly, the MAS injects specialized **Tool-Doctor** guidance into the prompt to break failure loops and harden implementation strategies.

## Integration & Defaults
- **Default Operation**: MAS is the default, authoritative path (`masEnabled: true`).
- **Control Interface**: Users maintain governance through the **Wave-Level Approval** system and the glassmorphism **Swarm Dashboard**.
- **Sequence**: `User Intent` -> `Grounding` -> `Authoritative Swarm Orchestration` -> `Concurrent Build (StreamPool)` -> `Deep Semantic Audit` -> `Task Finalization`.

## Webview UI Integration

The MAS architecture is not simply a background CLI process—it fundamentally transforms the CodeMarie VS Code Webview UX. A suite of advanced React components in `webview-ui` has been built to surface the multi-agent cognitive process directly to the user:

- **`SwarmDashboard.tsx`**: A persistent, sticky "cockpit" overlay that tracks real-time wave progress and active worker status using the `swarmState` synchronization protocol.
- **`OrchestrationEventRow.tsx`**: High-fidelity event logging for the swarm, providing real-time feedback on worker starts, completions, and results with specialized icons.
- **`WaveApprovalRow.tsx`**: A native governance UI that surfaces planned actions and architectural audit results for user review during wave transitions.
- **`SubagentStatusRow.tsx`**: Visually renders the real-time execution bounds of orchestrated parallel streams.
- **`RedTeamAlerts.tsx`**: Renders the adversarial critique payload from background red-teaming streams.
- **`ClarificationHub.tsx` & `IntentDecomposition.tsx`**: Surfaces the `Ikigai` intent analysis visually, allowing users to interactively clarify ambiguous project scopes.
- **`ThinkingRow.tsx`**: Captures real-time output from the Cognitive Fabric's internal reasoning engine.

## Reference Implementation
- **Controller**: `src/core/orchestration/OrchestrationController.ts`
- **Main Flow**: `src/core/orchestration/MultiAgentStreamSystem.ts`
- **Concurrent Pool**: `src/core/orchestration/StreamPool.ts`
- **Worker Agent**: `src/core/orchestration/WorkerStream.ts`
- **Coordinator**: `src/core/orchestration/StreamCoordinator.ts`
- **Context**: `src/core/broccolidb/agent-context.ts`
- **Webview Rendering**: `webview-ui/src/components/chat/` (`ChatRow.tsx`, `SubagentStatusRow.tsx`, `RedTeamAlerts.tsx`)
