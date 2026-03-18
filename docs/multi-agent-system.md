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

## Integration & Defaults
- **Default Operation**: MAS is enabled by default (`masEnabled: true`).
- **User Control**: Users can disable MAS in the global settings if single-agent execution is preferred.
- **Sequence**: `User Intent` -> `Grounding` -> `MAS Orchestration` -> `Task Execution`.

## Reference Implementation
- **Controller**: `src/core/orchestration/OrchestrationController.ts`
- **Main Flow**: `src/core/orchestration/MultiAgentStreamSystem.ts`
- **Context**: `src/core/broccolidb/agent-context.ts`
