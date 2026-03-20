import { dbPool } from "@/infrastructure/db/BufferedDbPool"
import { setDbPath } from "@/infrastructure/db/Config"

export interface AgentGitConfig {
	dbPath?: string
}

export class Connection {
	constructor(config?: AgentGitConfig) {
		if (config?.dbPath) {
			setDbPath(config.dbPath)
		}
	}

	getPool() {
		return dbPool
	}
}
