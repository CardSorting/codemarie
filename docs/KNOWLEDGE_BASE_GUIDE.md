# Knowledge Base Guide

Welcome to the CodeMarie Knowledge Base. This guide serves as a central map for navigating our sprawling documentation, organized by your specific needs.

## 🗺️ Documentation Domains

### 1. 🚀 Getting Started (User Domain)
If you are new to CodeMarie, start here to understand the core workflow.
- [What is CodeMarie?](getting-started/what-is-cline)
- [Quick Start Guide](getting-started/quick-start)
- [Your First Project](getting-started/your-first-project)

### 2. 🧬 Cognitive Architecture (Architect Domain)
Deep dives into the internal mechanics of CodeMarie's intelligence.
- [**Multi-Agent System (MAS)**](multi-agent-system): The core orchestration layer for multi-turn tasks.
- [**Intent Grounding**](features/intent-grounding): How we turn ambiguous requests into project-specific specs.
- [**Memory Bank (BroccoliDB)**](features/memory-bank): The persistent knowledge graph that powers long-term reasoning.
- [**Production Optimization Summary**](PRODUCTION_OPTIMIZATION_SUMMARY): Benchmark results and engineering details for the v3.84.0 hardening initiative.
- [**Hyper-Cognition Vision**](hyper-cognition/VISION): The long-term roadmap for architectural intelligence.

### 3. 🛠️ Development & Engineering (Developer Domain)
Technical references for extending or debugging the system.
- [**MAS Technical Architecture**](hyper-cognition/MAS_ARCHITECTURE): Detailed UML and sequence diagrams for sub-agent systems.
- [**Tools Reference**](tools-reference/all-cline-tools): API documentation for all built-in agentic tools.
- [**MCP Protocol**](mcp/mcp-overview): How to build and connect custom tool servers.

## 🔍 Navigation Tips
- **Searching**: Use `Cmd+K` (or the search bar) to find specific implementation details across the entire `docs/` folder.
- **Hierarchical Reading**: For a deep understanding, read **Intent Grounding** first, followed by **Multi-Agent System**, and finally **MAS Technical Architecture**.
- **Shared Reasoning**: Look for the `ANNOTATES` edges in BroccoliDB to trace the reasoning history of any task.

## 📋 Release Notes
Stay updated with the latest architectural hardening passes in the [Changelog](../CHANGELOG.md) and [Production Hardening Log](../CHANGELOG_V2.md).
