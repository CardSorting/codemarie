import Database from "better-sqlite3"
import { Kysely, SqliteDialect, CompiledQuery } from "kysely"
import * as path from "path"
import * as fs from "fs"

export interface Schema {
	agent_streams: {
		id: string
		externalId: string | null
		parentId: string | null
		focus: string
		status: "active" | "completed" | "failed"
		createdAt: number
	}
	agent_tasks: {
		id: string
		streamId: string
		description: string
		status: "pending" | "running" | "completed" | "failed"
		result: string | null
		metadata: string | null
		createdAt: number
	}
	agent_memory: {
		streamId: string
		key: string
		value: string
		updatedAt: number
	}
}

let _db: Kysely<Schema> | null = null
let _dbPath: string | null = null

export function setDbPath(dbPath: string) {
	_dbPath = dbPath
}

export async function getDb(): Promise<Kysely<Schema>> {
	if (_db) return _db
	if (!_dbPath) {
		throw new Error("Database path not set. Call setDbPath() before getDb().")
	}

	const dbDir = path.dirname(_dbPath)
	if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

	_db = new Kysely<Schema>({
		dialect: new SqliteDialect({
			database: new Database(_dbPath),
		}),
	})

	// Initialize Schema
	const execute = (q: string) => _db!.executeQuery(CompiledQuery.raw(q))
	await execute("PRAGMA journal_mode = WAL;")
	await execute("PRAGMA synchronous = NORMAL;")
	await execute("PRAGMA foreign_keys = ON;")
	
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_streams (
			id TEXT PRIMARY KEY, 
			externalId TEXT,
			parentId TEXT, 
			focus TEXT, 
			status TEXT, 
			createdAt BIGINT,
			FOREIGN KEY(parentId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_tasks (
			id TEXT PRIMARY KEY, 
			streamId TEXT NOT NULL, 
			description TEXT NOT NULL, 
			status TEXT NOT NULL DEFAULT 'pending', 
			result TEXT,
			metadata TEXT,
			createdAt BIGINT NOT NULL,
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_memory (
			streamId TEXT,
			key TEXT,
			value TEXT,
			updatedAt BIGINT,
			PRIMARY KEY(streamId, key),
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	
	// Indices
	await execute(`CREATE INDEX IF NOT EXISTS idx_tasks_stream ON agent_tasks(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_memory_stream ON agent_memory(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_streams_external ON agent_streams(externalId)`)

	return _db
}
