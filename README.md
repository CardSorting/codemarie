<div align="center">
  <img src="https://media.githubusercontent.com/media/codemarie/codemarie/main/assets/docs/hero.png" width="100%" alt="CodeMarie Hero" />
  <h1>CodeMarie</h1>
  <p><strong>The Layer-Aware AI Coding Partner. Engineered for Architectural Integrity.</strong></p>

  <p>
    <a href="https://marketplace.visualstudio.com/items?itemName=DreamBeesAI.marie-coder"><strong>Download on VS Marketplace</strong></a> |
  </p>
</div>

---

## 🏛️ Engineered for Integrity: Joy-Zoning

CodeMarie isn't just an LLM wrapper; it's an **architectural guardian**. At its core is **Joy-Zoning**, a sophisticated layering system that ensures your codebase remains clean, testable, and maintainable.

- **Domain**: Pure business logic, models, and rules. Zero side effects.
- **Core**: Task orchestration, prompt assembly, and tool coordination.
- **Infrastructure**: Adapters for the outside world (API clients, DB, File System).
- **UI**: Pure presentation logic following strict "render state, dispatch intention" patterns.
- **Plumbing**: Independent, stateless utilities used across all layers.

> [!IMPORTANT]
> **Fluid Policy Enforcement**: Our engine proactively monitors cross-layer imports and architectural smells, providing real-time "Strikes" and correction hints to keep the agent—and your team—aligned with best practices.

---

## 🧠 Advanced Agentic Intelligence

### 📍 Intent Grounding
Before taking action, CodeMarie performs an autonomous **Semantic Discovery** pass. It cross-references your intent with workspace reality, verifying file entities and project-specific rules (`.codemarierules`) to eliminate hallucinations and maximize precision.

### ⚡ Fluid Policy Engine
Experience unmatched stability with our safety-first runtime.
- **Recursion Detection**: Prevents infinite loops by monitoring per-file and cross-turn read counts.
- **Entropy Monitoring**: Safely detects when tool outputs diverge from expected states.
- **Collision Protection**: Manages locks between parallel subagents to prevent data corruption.

---

## 🛠️ The Ultimate Tool Suite (30+)

CodeMarie comes equipped with an extensive directory of built-in tools, categorized for maximum efficiency:

- **📂 File & Workspace**: Advanced regex search (`search_files`), AST-based code exploration (`list_code_definition_names`), and precise diff-aware editing.
- **💻 Terminal**: Full CLI integration with real-time output monitoring and error reaction.
- **🌐 Browser Use**: Headless Puppeteer control for E2E testing, visual debugging, and screenshot-aided UI fixes.
- **🧩 MCP Integration**: Connect to Jira, AWS, PagerDuty, or **create and install your own tools** on the fly.
- **🤖 Orchestration**: Spawn specialized **Subagents** or utilize **Skills** to handle hyper-specific domains.

---

## 🚀 Proactive Context Management

Working on a massive monolith? No problem.
- **Duplicate Suppression**: Automatically filters redundant file reads to maximize token budget.
- **Intelligent Truncation**: Maintains task continuity by preserving core objectives while sliding the conversation window.
- **Token Awareness**: Proactively warns and shifts strategies as you approach model context limits.

---

## 🛡️ Human-in-the-Loop Safety

Efficiency shouldn't come at the cost of control.
1. **Plan Mode**: Architect your solution alongside CodeMarie. Discuss, refine, and approve the blueprint before a single line of code is written.
2. **Act Mode**: Watch as CodeMarie executes with precision. You approve every file write and terminal command.
3. **Checkpoints**: Every step is snapshotted. Compare diffs or restore your entire workspace with a single click.

---

## 🏗️ Getting Started

### Installation
1. Install **CodeMarie** via the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DreamBeesAI.marie-coder).
2. Configure your provider (Anthropic, OpenAI, Gemini, Bedrock, OpenRouter).
3. Type your first goal and watch CodeMarie plan.

### For Contributors (CLI & SDK)
```bash
# Clone and Build
git clone https://github.com/CardSorting/codemarie.git
npm install && npm run build

# Link the CLI
cd cli && npm link
```

---

## 📜 License

[Apache 2.0 © 2026 CodeMarie Bot Inc.](./LICENSE)
