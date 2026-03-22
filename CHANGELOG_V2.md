# Changelog (V2)

## [3.82.0] - 2026-03-22

### Added
- **Oracle Grade Suggestion Engine (Rounds 1-6 Hardening)**:
  - Developed a high-precision, architecturally-aware suggestion engine with **8-way Parallelized Context Gathering**.
  - Introduced **Smart Symbol Expansion** (Spider-Powered): Resolving workspace-wide definitions for symbols involved in active diagnostics.
  - Implemented **Project-Wide Consistency Injection**: Automatically extracting and enforcing architectural patterns and design idioms from the AgentContext.
  - Added **Semantic Importance Windowing**: Using BroccoliDB to ground suggestions in the most critical code blocks rather than just file headers.
  - Defined **Oracle Modes** (Fix, Design, Learn) for intent-based diversity in AI-prompted suggestions.
  - Integrated **Granular Telemetry** for monitoring component-level latency (Diagnostics, Broccoli, Tree-Sitter, Git).
  - Full model personalization: Honoring user-selected models across all API providers with modern high-performance fallbacks.

### Fixed
- **Suggestion Latency**: Optimized context pipelines to maintain <2s generation even with deep workspace grounding.
- **Redundant Suggestions**: Implemented a similarity filter and history buffer to prevent repetitive prompt cycles.
- **Dependency Guarding**: Infused system prompts with architectural guardrails to prevent circular dependencies in AI-generated plans.

## [3.81.0] - 2026-03-22
 
### Added
- **Spider Structural Intelligence Engine**:
  - Implemented high-performance structural analysis suite for detecting **Structural Entropy** and enforcing **Architectural Sovereignty**.
  - Introduced **Incremental $O(C)$ Audits** using CAS hashes for near-instantaneous architectural health checks on every commit.
  - Developed the **Four Pillar Model** for quantifying health: Cognitive Depth, Semantic Consistency, Ecological Integrity, and Modular Sovereignty.
  - Added **Blast Radius Intelligence** to predict multi-hop impact of proposed changes.
  - Full documentation suite including `SPIDER.md` (Technical Guide) and `SPIDER_THEORY.md` (Philosophical Foundations).
 
### Fixed
- **Architectural Decay**: Replaced expensive $O(N)$ full-repo scans with optimized incremental logic in `repository.ts`.
- **Type Safety**: Synchronized types and resolved multiple `any` diagnostics across the core reasoning substrate.
- **Biomed Synchronization**: Project-wide alignment with Biome linting rules for structural components.
 
## [3.78.0] - 2026-03-18
 
### Added
- **Production Hardening (MAS):**
  - Replaced placeholder `simulateMerge` logic with true Least Common Ancestor (LCA) semantic conflict resolution in KnowledgeGraph.
  - Replaced `simulateMergeForecast` mockups with dual-branch, multi-hop blast radius intersection engines.
  - Upgraded Grounding validation by replacing "simulated" prompts with real concurrent Sub-Agent Streams for 'Swarm Consensus' and 'Red-Team Critique'.
