# ADR 005: Oracle Grade Suggestion Engine (Rounds 1-6)

## Status
Accepted

## Context
The previous suggestion system relied on shallow, local file context (head of file) and lacked awareness of project-wide architectural patterns and diagnostic-specific types. This led to suggestions that, while syntactically correct, often violated "Joy-Zoning" guardrails or failed to provide a "Primary Fix" for active workspace errors.

## Decision
We decided to transform the suggestion system into the **"Oracle Grade"** Suggestion Engine through 6 rounds of deep production hardening. The key architectural shifts are:
1.  **8-way Parallel Context Pipeline**: Gathering intelligence from BroccoliDB, Git, Tree-Sitter, SpiderEngine, and Diagnostics concurrently to maximize grounding without increasing latency.
2.  **Semantic Importance Windowing**: Using BroccoliDB to identify critical logic blocks anywhere in the file to ground the AI's understanding.
3.  **Diagnostic-Specific Grounding (Spider-Powered)**: Performing workspace-wide resolution for symbols involved in active errors to provide definitive fixes.
4.  **Intent-Based Cognitive Modes**: Categorizing suggestions into "Oracle Fix", "Oracle Design", and "Oracle Learn" to meet diverse developer needs.
5.  **Similarity & History Filtering**: Preventing redundant or repetitive suggestion sequences to maintain UX freshness.

## Consequences
- **Positive**: Near-perfect precision for diagnostic resolution; suggestions are now architecturally consistent with project-wide patterns.
- **Positive**: High-fidelity telemetry provides operational visibility into context gathering health.
- **Negative**: Increased complexity in `SuggestionService.ts` due to multi-component parallelization and lazy-loading of heavy dependencies like `tree-sitter` and `biome`.
- **Mitigation**: Lazy `require()` calls and comprehensive architectural guarding for all context sources.

## Links
- [SUGGESTION_ENGINE.md](./SUGGESTION_ENGINE.md)
- [SuggestionService.ts](./SuggestionService.ts)
