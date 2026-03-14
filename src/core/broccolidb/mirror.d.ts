import { Repository } from "./repository.js"
/**
 * LocalMirror Prototype
 * Inspired by Cline's "Shadow Git" checkpointing system.
 * It provides an ultra-fast local-first logging system that asynchronously
 * pushes metadata patches to the AgentGit cloud repository.
 */
export declare class LocalMirror {
	private readonly repo
	private readonly branch
	private readonly localDirPath
	private git
	constructor(repo: Repository, branch: string, localDirPath: string)
	/**
	 * Initializes the shadow git local mirror.
	 */
	init(): Promise<void>
	/**
	 * Commits all changes to the local shadow git, and asynchronously logs
	 * the patch event to the cloud via the AgentGit Repository.
	 */
	commit(message: string): Promise<string>
	private syncToCloud
	/**
	 * Generates a structural summary of modifications.
	 */
	diffSummary(hashA: string, hashB?: string): Promise<any>
}
//# sourceMappingURL=mirror.d.ts.map
