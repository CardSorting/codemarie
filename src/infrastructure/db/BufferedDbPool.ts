import { Kysely } from "kysely"
import { Logger } from "@/shared/services/Logger"
import { Mutex } from "../plumbing/Plumbing"
import { getDb, Schema } from "./Config"

export type DbLayer = "domain" | "infrastructure" | "ui" | "plumbing"

type WhereCondition = { column: string; value: string | number }

export type WriteOp = {
	type: "insert" | "update" | "delete" | "upsert"
	table: keyof Schema
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely's InsertExpression/UpdateExpression require generic compatibility
	values?: Record<string, string | number | boolean | null | undefined>
	where?: WhereCondition | WhereCondition[]
	agentId?: string
	layer?: DbLayer
}

const LAYER_PRIORITY: Record<DbLayer, number> = {
	domain: 0,
	infrastructure: 1,
	ui: 2,
	plumbing: 3,
}

function normalizeWhere(where: WhereCondition | WhereCondition[] | undefined): WhereCondition[] {
	if (!where) return []
	return Array.isArray(where) ? where : [where]
}

export class BufferedDbPool {
	private globalBuffer: WriteOp[] = []
	private inFlightOps: WriteOp[] = []
	private agentShadows = new Map<string, { ops: WriteOp[]; affectedFiles: Set<string> }>()
	private stateMutex = new Mutex("DbStateMutex")
	private flushMutex = new Mutex("DbFlushMutex")
	private flushInterval: NodeJS.Timeout | null = null
	private db: Kysely<Schema> | null = null

	constructor() {
		this.startFlushLoop()
	}

	private async ensureDb(): Promise<Kysely<Schema>> {
		if (!this.db) {
			this.db = await getDb()
		}
		return this.db
	}

	private startFlushLoop() {
		if (this.flushInterval) return
		this.flushInterval = setInterval(() => this.flush(), 100)
	}

	public async beginWork(agentId: string) {
		const release = await this.stateMutex.acquire()
		try {
			if (!this.agentShadows.has(agentId)) {
				this.agentShadows.set(agentId, { ops: [], affectedFiles: new Set() })
			}
		} finally {
			release()
		}
	}

	public async push(op: WriteOp, agentId?: string, affectedFile?: string) {
		let shouldFlush = false
		const release = await this.stateMutex.acquire()
		try {
			// Proactive Conflict Detection: Check for overlaps across global buffer AND other agent shadows
			if (op.where) {
				const conflicts = this.detectConflicts([op], agentId || "global")
				if (conflicts.length > 0) {
					throw new Error(`[DbPool] Proactive conflict detected: ${conflicts.join(", ")}`)
				}
			}

			if (agentId) {
				const shadow = this.agentShadows.get(agentId) || { ops: [], affectedFiles: new Set() }
				shadow.ops.push({ ...op, agentId })
				if (affectedFile) shadow.affectedFiles.add(affectedFile)
				this.agentShadows.set(agentId, shadow)
			} else {
				this.globalBuffer.push(op)
			}
			// Check threshold inside mutex so buffer length is not stale
			shouldFlush = this.globalBuffer.length > 50
		} finally {
			release()
		}

		if (shouldFlush) {
			this.flush().catch((e) => Logger.error("[DbPool] Auto-flush error:", e))
		}
	}

	/**
	 * Returns all uncommitted operations for a specific agent shadow.
	 */
	public getShadowOps(agentId: string): WriteOp[] {
		return this.agentShadows.get(agentId)?.ops || []
	}

	public async commitWork(
		agentId: string,
		validator?: (affectedFiles: Set<string>, ops: WriteOp[]) => Promise<{ success: boolean; errors: string[] }>,
	) {
		const release = await this.stateMutex.acquire()
		let shadow: { ops: WriteOp[]; affectedFiles: Set<string> } | undefined
		try {
			shadow = this.agentShadows.get(agentId)
			if (!shadow || shadow.ops.length === 0) return
			this.agentShadows.delete(agentId)
		} finally {
			release()
		}

		if (!shadow) return

		const conflicts = this.detectConflicts(shadow.ops, agentId)
		if (conflicts.length > 0) {
			throw new Error(`[DbPool] Conflict detected for agent ${agentId}: ${conflicts.join(", ")}`)
		}

		// Architectural Commit Hook delegated to validator
		if (validator && shadow.affectedFiles.size > 0) {
			const validation = await validator(shadow.affectedFiles, shadow.ops)
			if (!validation.success) {
				// Record the failure in the DB audit trail before throwing
				this.globalBuffer.push({
					type: "insert",
					table: "agent_tasks",
					values: {
						id: `audit-${Date.now()}`,
						streamId: agentId,
						description: "Architectural Audit Failure",
						status: "failed",
						result: `Rejected commit due to violations: ${validation.errors.join("; ")}`,
						metadata: JSON.stringify({ violations: validation.errors }),
						createdAt: Date.now(),
					},
					layer: "infrastructure",
				})
				throw new Error(
					`[DbPool] COMMIT REJECTED: Architectural entropy detected. Violations: ${validation.errors.join("; ")}`,
				)
			}
		}

		const releaseForPush = await this.stateMutex.acquire()
		try {
			this.globalBuffer.push(...shadow.ops)
		} finally {
			releaseForPush()
		}
		await this.flush()
	}

	public async rollbackWork(agentId: string, reason?: string) {
		const release = await this.stateMutex.acquire()
		let shadow: { ops: WriteOp[] } | undefined
		try {
			shadow = this.agentShadows.get(agentId)
			this.agentShadows.delete(agentId)
		} finally {
			release()
		}

		if (shadow && shadow.ops.length > 0) {
			// Audit trail for the rollback itself
			this.push({
				type: "insert",
				table: "agent_tasks",
				values: {
					id: `rollback-${Date.now()}`,
					streamId: agentId,
					description: "Agent Work Rolled Back",
					status: "failed",
					result: reason || "Explicit rollback called",
					metadata: JSON.stringify({ rolledBackOps: shadow.ops.length }),
					createdAt: Date.now(),
				},
				layer: "infrastructure",
			}).catch(() => {})
		}
	}

	public async getActiveAffectedFiles(): Promise<Map<string, string>> {
		const release = await this.stateMutex.acquire()
		const fileMap = new Map<string, string>()
		try {
			for (const [agentId, shadow] of this.agentShadows.entries()) {
				for (const file of shadow.affectedFiles) {
					fileMap.set(file, agentId)
				}
			}
		} finally {
			release()
		}
		return fileMap
	}

	private detectConflicts(shadow: WriteOp[], agentId: string): string[] {
		const conflicts: string[] = []
		const getWhereKey = (op: WriteOp): string | null => {
			if (!op.where) return null
			const conditions = normalizeWhere(op.where)
			return conditions
				.map((c) => `${c.column}=${c.value}`)
				.sort()
				.join(",")
		}
		for (const op of shadow) {
			const key = getWhereKey(op)
			if (!key) continue

			// 1. Check against global committed buffer
			const globalOverlap = this.globalBuffer.some((gOp) => gOp.table === op.table && getWhereKey(gOp) === key)
			if (globalOverlap) conflicts.push(`Overlapping mutation on ${op.table}:${key} (already in global buffer)`)

			// 2. Check against other agents' uncommitted shadows
			for (const [otherId, otherShadow] of this.agentShadows.entries()) {
				if (otherId === agentId) continue
				const shadowOverlap = otherShadow.ops.some((sOp) => sOp.table === op.table && getWhereKey(sOp) === key)
				if (shadowOverlap)
					conflicts.push(
						`Overlapping mutation on ${op.table}:${key} (conflicting with active Stream ${otherId.slice(0, 8)})`,
					)
			}
		}
		return conflicts
	}

	public async flush() {
		const releaseFlush = await this.flushMutex.acquire()
		let flushReleased = false
		let opsToFlush: WriteOp[] = []
		try {
			const releaseState = await this.stateMutex.acquire()
			try {
				if (this.globalBuffer.length === 0) {
					releaseFlush()
					flushReleased = true
					return
				}
				opsToFlush = [...this.globalBuffer].sort((a, b) => {
					const pA = LAYER_PRIORITY[a.layer || "plumbing"]
					const pB = LAYER_PRIORITY[b.layer || "plumbing"]
					return pA - pB
				})
				this.globalBuffer = []
				// Publish in-flight ops so concurrent reads can still see them
				this.inFlightOps = opsToFlush
			} finally {
				releaseState()
			}

			const db = await this.ensureDb()

			const startTime = Date.now()
			// Kysely requires `as any` casts for dynamic table/column references
			// because the table name is a runtime variable, not a compile-time literal.
			// This is the boundary between our typed WriteOp and Kysely's generic API.
			await db.transaction().execute(async (trx) => {
				for (const op of opsToFlush) {
					const conditions = normalizeWhere(op.where)
					if (op.type === "insert" && op.values) {
						await trx
							.insertInto(op.table as any)
							.values(op.values as any)
							.execute()
					} else if (op.type === "upsert" && op.values) {
						// For SQLite, 'INSERT OR REPLACE' is the closest to a clean upsert
						// provided we have primary keys defined.
						await trx
							.insertInto(op.table as any)
							.values(op.values as any)
							.onConflict((oc) => oc.doUpdateSet(op.values as any))
							.execute()
					} else if (op.type === "update" && op.values) {
						let query = trx.updateTable(op.table as any).set(op.values as any)
						for (const cond of conditions) {
							query = query.where(cond.column as any, "=", cond.value as any)
						}
						await query.execute()
					} else if (op.type === "delete") {
						let query = trx.deleteFrom(op.table as any)
						for (const cond of conditions) {
							query = query.where(cond.column as any, "=", cond.value as any)
						}
						await query.execute()
					}
				}
			})
			const duration = Date.now() - startTime
			if (duration > 50) {
				Logger.info(`[DbPool] Slow flush detected: ${duration}ms for ${opsToFlush.length} ops`)
			}
			// Transaction succeeded — clear in-flight ops
			const releaseStateClear = await this.stateMutex.acquire()
			try {
				this.inFlightOps = []
			} finally {
				releaseStateClear()
			}
		} catch (e) {
			Logger.error("[DbPool] Flush failed, restoring ops to buffer:", e)
			// CRITICAL: Restore failed ops back to the front of the buffer
			// so they are retried on the next flush cycle.
			const releaseState = await this.stateMutex.acquire()
			try {
				this.globalBuffer.unshift(...opsToFlush)
				this.inFlightOps = []
			} finally {
				releaseState()
			}
		} finally {
			if (!flushReleased) {
				releaseFlush()
			}
		}
	}

	public async selectWhere<T extends keyof Schema>(
		table: T,
		where: WhereCondition | WhereCondition[],
		agentId?: string,
	): Promise<Schema[T][]> {
		const release = await this.stateMutex.acquire()
		try {
			const db = await this.ensureDb()
			const conditions = normalizeWhere(where)

			let query = db.selectFrom(table as any).selectAll()
			for (const cond of conditions) {
				query = query.where(cond.column as any, "=", cond.value as any)
			}

			const diskResults = (await query.execute()) as Schema[T][]

			// Apply pending inserts/updates/deletes from global and shadow buffers in order
			const applyOps = (ops: WriteOp[], base: Schema[T][]) => {
				let results = [...base]
				for (const op of ops) {
					if (op.table !== table) continue

					if ((op.type === "insert" || op.type === "upsert") && op.values) {
						const rec = op.values as unknown as Schema[T]
						if (conditions.every((c) => (rec as any)[c.column] === c.value)) {
							// For upsert, we need to check if we're replacing an existing record in the results
							const pkMatch = (r: any) => {
								// Heuristic: check id or streamId+key
								if (op.table === "agent_memory")
									return r.streamId === (rec as any).streamId && r.key === (rec as any).key
								return r.id === (rec as any).id
							}
							const existingIdx = results.findIndex(pkMatch)
							if (existingIdx >= 0) {
								results[existingIdx] = { ...results[existingIdx], ...rec }
							} else {
								results.push(rec)
							}
						}
					} else if (op.type === "delete" && op.where) {
						const delConds = normalizeWhere(op.where)
						results = results.filter((r) => {
							const rec = r as Record<string, unknown>
							return !delConds.every((c) => rec[c.column] === c.value)
						})
					} else if (op.type === "update" && op.where && op.values) {
						const updConds = normalizeWhere(op.where)
						results = results.map((r) => {
							const rec = r as Record<string, unknown>
							if (updConds.every((c) => rec[c.column] === c.value)) {
								return { ...r, ...op.values } as unknown as Schema[T]
							}
							return r
						})
					}
				}
				return results
			}

			// Apply in order: in-flight (being flushed) → global buffer → agent shadow
			let finalResults = applyOps(this.inFlightOps, diskResults)
			finalResults = applyOps(this.globalBuffer, finalResults)
			if (agentId) {
				const shadow = this.agentShadows.get(agentId)
				if (shadow) {
					finalResults = applyOps(shadow.ops, finalResults)
				}
			}

			return finalResults
		} finally {
			release()
		}
	}

	public async selectOne<T extends keyof Schema>(
		table: T,
		where: WhereCondition | WhereCondition[],
		agentId?: string,
	): Promise<Schema[T] | null> {
		const results = await this.selectWhere(table, where, agentId)
		return results.length > 0 ? results[results.length - 1] : null
	}

	public async selectAllFrom<T extends keyof Schema>(table: T, agentId?: string): Promise<Schema[T][]> {
		return this.selectWhere(table, [], agentId)
	}

	public async stop() {
		if (this.flushInterval) {
			clearInterval(this.flushInterval)
			this.flushInterval = null
		}
		// Drain guarantee: retry flush up to 3 times if buffer is non-empty
		for (let attempt = 0; attempt < 3; attempt++) {
			await this.flush()
			if (this.globalBuffer.length === 0) return
			Logger.warn(`[DbPool] Stop: buffer not empty after flush attempt ${attempt + 1}, retrying...`)
		}
		if (this.globalBuffer.length > 0) {
			Logger.error(`[DbPool] Stop: ${this.globalBuffer.length} ops could not be flushed after 3 attempts`)
		}
	}
}

export const dbPool = new BufferedDbPool()
