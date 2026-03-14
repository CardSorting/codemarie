import type { FileTree } from "./file-tree.js"
export declare class AgentIgnore {
	private ig
	constructor(rules: string)
	/**
	 * Loads the .agentignore rules from the root of the given branch.
	 */
	static load(files: FileTree, branch: string): Promise<AgentIgnore>
	/**
	 * Checks whether the specified file path is restricted by .agentignore rules.
	 */
	isIgnored(filePath: string): boolean
}
//# sourceMappingURL=ignore.d.ts.map
