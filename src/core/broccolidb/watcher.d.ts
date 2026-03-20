import { Repository } from "./repository"
export declare class LocalWatcher {
	private readonly repo
	private readonly branch
	private readonly localDirPath
	private readonly author
	private watcher
	private isProcessing
	private queue
	constructor(repo: Repository, branch: string, localDirPath: string, author?: string)
	start(): Promise<void>
	stop(): Promise<void>
	private enqueue
	private processQueue
}
//# sourceMappingURL=watcher.d.ts.map
