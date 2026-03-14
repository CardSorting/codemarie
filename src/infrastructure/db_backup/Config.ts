import Database from "better-sqlite3"
import * as fs from "fs"
import { CompiledQuery, Kysely, SqliteDialect } from "kysely"
import * as path from "path"

export interface Schema {
	agent_streams: {
		id: string
		externalId: string | null
		parentId: string | null
		focus: string
		status: "active" | "completed" | "failed"
		sharedMemoryLayer: string | null // JSON array
		createdAt: number
	}
	agent_tasks: {
		id: string
		streamId: string
		description: string
		status: "pending" | "running" | "completed" | "failed"
		result: string | null
		complexity: number
		linkedKnowledgeIds: string | null // JSON array
		metadata: string | null
		createdAt: number
	}
	agent_memory: {
		streamId: string
		key: string
		value: string
		updatedAt: number
	}
	agent_cognitive_snapshots: {
		id: string
		streamId: string
		content: string
		embedding: string
		metadata: string | null
		createdAt: number
	}
	agent_knowledge: {
		id: string
		userId: string
		streamId: string
		type: string // 'fact' | 'vector' | 'rule'
		content: string
		tags: string // JSON array
		embedding: string | null // JSON array
		confidence: number
		hubScore: number
		expiresAt: number | null
		metadata: string | null // JSON object
		createdAt: number
	}
	agent_knowledge_edges: {
		sourceId: string
		targetId: string
		type: string // 'supports' | 'contradicts' | 'blocks' | 'depends_on' | 'references'
		weight: number
		createdAt: number
	}
	telemetry: {
		id: string
		repoPath: string
		agentId: string
		taskId: string | null
		promptTokens: number
		completionTokens: number
		totalTokens: number
		modelId: string
		cost: number
		timestamp: number
		environment: string // JSON string
	}
	telemetry_aggregates: {
		repoPath: string
		id: string // 'global', 'agent_{id}', 'task_{id}'
		totalCommits: number
		totalTokens: number
		totalCost: number
	}
	swarm_locks: {
		resource: string
		ownerId: string
		expiresAt: number
		createdAt: number
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
	const execute = (q: string) => _db?.executeQuery(CompiledQuery.raw(q))
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
			sharedMemoryLayer TEXT,
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
			complexity REAL DEFAULT 1.0,
			linkedKnowledgeIds TEXT,
			metadata TEXT,
			createdAt BIGINT NOT NULL,
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS telemetry (
			id TEXT PRIMARY KEY,
			repoPath TEXT NOT NULL,
			agentId TEXT NOT NULL,
			taskId TEXT,
			promptTokens INTEGER NOT NULL,
			completionTokens INTEGER NOT NULL,
			totalTokens INTEGER NOT NULL,
			modelId TEXT NOT NULL,
			cost REAL NOT NULL,
			timestamp BIGINT NOT NULL,
			environment TEXT
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS telemetry_aggregates (
			repoPath TEXT NOT NULL,
			id TEXT NOT NULL,
			totalCommits INTEGER DEFAULT 0,
			totalTokens INTEGER DEFAULT 0,
			totalCost REAL DEFAULT 0,
			PRIMARY KEY(repoPath, id)
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
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_cognitive_snapshots (
			id TEXT PRIMARY KEY,
			streamId TEXT NOT NULL,
			content TEXT NOT NULL,
			embedding TEXT NOT NULL,
			metadata TEXT,
			createdAt BIGINT NOT NULL,
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_knowledge (
			id TEXT PRIMARY KEY,
			userId TEXT NOT NULL,
			streamId TEXT NOT NULL,
			type TEXT NOT NULL,
			content TEXT NOT NULL,
			tags TEXT,
			embedding TEXT,
			confidence REAL DEFAULT 1.0,
			hubScore INTEGER DEFAULT 0,
			expiresAt BIGINT,
			metadata TEXT,
			createdAt BIGINT NOT NULL,
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_knowledge_edges (
			sourceId TEXT NOT NULL,
			targetId TEXT NOT NULL,
			type TEXT NOT NULL,
			weight REAL DEFAULT 1.0,
			createdAt BIGINT NOT NULL,
			PRIMARY KEY(sourceId, targetId, type),
			FOREIGN KEY(sourceId) REFERENCES agent_knowledge(id),
			FOREIGN KEY(targetId) REFERENCES agent_knowledge(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS swarm_locks (
			resource TEXT PRIMARY KEY,
			ownerId TEXT NOT NULL,
			expiresAt BIGINT NOT NULL,
			createdAt BIGINT NOT NULL
		)`,
	)

	// Indices
	await execute(`CREATE INDEX IF NOT EXISTS idx_swarm_locks_owner ON swarm_locks(ownerId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_swarm_locks_expires ON swarm_locks(expiresAt)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_tasks_stream ON agent_tasks(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_memory_stream ON agent_memory(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_streams_external ON agent_streams(externalId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_cognitive_snapshots_stream ON agent_cognitive_snapshots(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_knowledge_stream ON agent_knowledge(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_knowledge_type ON agent_knowledge(type)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_edges_source ON agent_knowledge_edges(sourceId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_edges_target ON agent_knowledge_edges(targetId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_telemetry_task ON telemetry(taskId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_telemetry_agent ON telemetry(agentId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_telemetry_repo ON telemetry(repoPath)`)

	return _db
}
