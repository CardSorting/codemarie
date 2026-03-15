# CodeMarie: The Architectural Guardian

![CodeMarie Banner](assets/branding/banner.png)

**CodeMarie** is an industrial-grade, model-agnostic agentic coding assistant designed to maintain architectural integrity in complex software ecosystems. Beyond simple code generation, CodeMarie acts as an **Architectural Guardian**, enforcing strict layering, managing distributed agentic workflows, and ensuring transactional stability across your workspace.

> [!IMPORTANT]
> **State-of-the-Art Production Hardening (v3.74.0)**: This release introduces the Swarm Swarm Intelligence layer, featuring Adaptive Budgeting, Consensus Protocols, and 99% faster Rocket Grounding.

---

## 🏗️ Core Pillars of Intelligence

### 🧬 Joy-Zoning Framework
CodeMarie enforces a rigorous architectural pattern known as **Joy-Zoning**. It automatically categorizes every file into one of five distinct layers and enforces "Outside-In" dependency rules. 

> [!TIP]
> Use the **Fluid Policy Engine** to monitor every file operation and prevent layer leaks in real-time.

### 🧠 Hyper-Cognition & Long-Term Memory
CodeMarie moves beyond simple context windows via a persistent **Knowledge Graph** (BroccoliDB) and the **Rocket Generation** grounding pipeline:
*   **Rocket Grounding**: 99% reduction in grounding latency via virtualized workspace indexing and heuristic fast-paths.
*   **Semantic Compaction**: Automatically landmarks high-value architectural decisions to survive context prunings.
*   **Knowledge Graph (KG) Resilience**: Self-healing graph nodes that automatically repair broken semantic links during repo churn.
*   **Speculative Pipeline**: Preview multi-hop impact of intent grounded changes (`MEM_BLAST`) before execution.

### 🐝 Swarm Coordination & Adaptive Intelligence
Industrial-grade orchestration for distributed, self-correcting workflows:
*   **Persistent Swarm Mutexes**: DB-backed locking (`swarm_locks`) that survives process restarts and ensures cross-agent synchronization.
*   **Adaptive Budgeting**: Token-aware and cost-aware recursion guardrails that automatically prevent runaway subagent executions.
*   **Swarm Consensus Protocol**: Integrated peer-verification mechanism where subagents validate findings and signals before finalization.
*   **Autonomous Nudges**: Automatic self-correction layer for subagents encountering context uncertainty or "Toxic Hotspots."
*   **Type-Safe Swarm Coordination**: Fully structured signaling and hierarchical memory blackboard for high-reliability swarm operations.

### 🛡️ Transactional Stability & Speculation
*   **Ghost Branches**: Create ephemeral, Git-backed playgrounds for speculative refactors without polluting task history.
*   **Atomic Workspaces**: Complete restoration of any previous state via a git-backed checkpointing system.
*   **Foundational Resilience**: Deep cross-resource grounding stability that ensures architectural integrity during high-entropy refactors.
*   **DB Shadowing**: Every workspace modification is staged in a transactional buffer before being committed.

---

## 🛠️ Industrial Infrastructure

### 🔗 Advanced MCP Hub
Full integration with the **Model Context Protocol (MCP)**:
- **SSE & Stdio Transports**: Multi-protocol support for local and remote tool servers.
- **Native OAuth**: Integrated authentication for enterprise-grade tool integrations.
- **Dynamic Env Expansion**: Intelligent environment variable resolution for sensitive configurations.

### 📊 OpenTelemetry Observability
High-fidelity telemetry for audit trails and performance tuning:
- **TTFT & Latency Tracking**: Real-time monitoring of Time to First Token.
- **Token Economics**: Precise cost tracking per task, turn, and subagent.
- **Stability Metrics**: Monitoring "Architectural Entropy" and policy violation trends.

---

## 🚀 Model-Specific Optimization
CodeMarie provides custom-tuned **Prompt Variants** to extract maximum performance from frontier models:
- **Gemini 3.0 & GPT-5**: Native tool-calling optimizations and high-token window handling.
- **Trinity & Native Next-Gen**: Advanced reasoning prompts for complex system design.
- **Crossover/Search Models**: Specialized grounding for web-assisted research.

---

## 📐 System Architecture

```mermaid
graph TD
    User((User)) --> Webview[VS Code Webview]
    Webview --> Controller[Core Controller]
    
    subgraph "Fluid Policy Engine"
        Controller --> JoyZoning[Joy-Zoning Guard]
        JoyZoning --> SQLite[(Persistence Layer)]
        JoyZoning --> Mutex[Persistent Mutexes]
    end
    
    subgraph "Hyper-Cognition"
        Controller --> Graph[Knowledge Graph]
        Graph --> Embeddings[Gemini Embeddings]
        Graph --> Analysis[Blast/Forecast]
        Graph --> Rocket[Rocket Grounding Index]
    end
    
    subgraph "Agentic Swarm (v3.74.0)"
        Controller --> ParentStream[Parent Agent]
        ParentStream --> Subagent1[Subagent A]
        ParentStream --> Subagent2[Subagent B]
        Subagent1 & Subagent2 --> Consensus[Consensus Handler]
        Consensus --> Signaling[Signaling Layer]
        Signaling --> SharedMemory[Shared Memory Blackboard]
        Subagent1 & Subagent2 --> SharedMemory
    end
    
    Controller --> MCP[MCP Hub]
```

---

---

## 📈 Performance & Core Benchmarks

CodeMarie isn't just more capable; it's faster and more cost-effective.

| Metric | Legacy Baseline | CodeMarie 3.74.0 | Improvement |
| :--- | :--- | :--- | :--- |
| **Grounding Latency** | ~45s (Large Repo) | **< 2s** | **99% Faster** |
| **Swarm Stability** | Frequent Loops | **Atomic Consensus** | **High Reliability** |
| **Context Recovery** | Manual Re-prompt | **Autonomous Nudges** | **Self-Correction** |
| **Memory Blast Radius** | Single-Hop | **Global Speculative** | **Full Coverage** |

---

## 🗺️ Joy-Zoning Visual Map

CodeMarie maintains architectural purity by enforcing strict boundaries across five critical layers:

```mermaid
graph LR
    L1[Layer 1: Shared/Core] --- L2[Layer 2: Services]
    L2 --- L3[Layer 3: UI/Handlers]
    L3 --- L4[Layer 4: Controllers]
    L4 --- L5[Layer 5: Orchestration]
    
    style L1 fill:#1e293b,stroke:#3b82f6,color:#fff
    style L2 fill:#1e293b,stroke:#a855f7,color:#fff
    style L3 fill:#1e293b,stroke:#ec4899,color:#fff
    style L4 fill:#1e293b,stroke:#eab308,color:#fff
    style L5 fill:#1e293b,stroke:#22c55e,color:#fff
```

> [!NOTE]
> Dependency violations (e.g., L1 importing L5) are blocked by the **Universal Guard** with a `JOY_VIOLATION` signal.

---

## ⚡ Quick Start

1.  **Install**: Search for "CodeMarie" in the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=codemarie.codemarie).
2.  **Configure**: Add your API keys for [OpenRouter](https://openrouter.ai/), [Anthropic](https://www.anthropic.com/), [Google](https://ai.google.dev/), or [AWS Bedrock](https://aws.amazon.com/bedrock/).
3.  **Activate**: Click the CodeMarie icon in the sidebar and start your first "Architectural Intent" grounded task.

---

## 🤝 Contributing
Join us in building the world's most robust agentic assistant. Please read our [Contribution Guidelines](CONTRIBUTING.md) and [Security Policy](SECURITY.md).

---
## 🕰️ History & Origins
**CodeMarie** is a completely transformed, industrial-grade evolution of the original [Cline](https://github.com/cline/cline) repository. While it shares foundational DNA, the architecture, orchestration, and policy safeguarding have been reconstructed from the ground up to support enterprise-scale agentic coding.

---
*Built with ❤️ by the CodeMarie Team. Architectural Integrity is not an option; it's the core.*
