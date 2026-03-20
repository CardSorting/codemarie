import type { Repository } from "./repository"
import type { AgentContext } from "./agent-context"
export declare class AgentGitMCP {
	private server
	private repo
	private agentContext?
	constructor(repo: Repository, agentContext?: AgentContext)
	private registerTools
	/**
	 * Starts the MCP server via standard I/O streams.
	 * This is how agent clients like Cursor or Claude Desktop connect natively.
	 */
	start(): Promise<void>
}
//# sourceMappingURL=mcp.d.ts.map
