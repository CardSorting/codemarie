import * as crypto from "node:crypto"
import { Kysely, sql } from "kysely"
import { Logger } from "@/shared/services/Logger"
import { getDb, type Schema } from "./Config"

// Robust Mutex implementation
class Mutex {
	private promise: Promise<void> = Promise.resolve()
	constructor(public name: string) {}

	async acquire() {
		let release: () => void
		const nextPromise = new Promise<void>((resolve) => {
			release = resolve
		})
		const currentPromise = this.promise
		this.promise = nextPromise
		await currentPromise
		return release!
	}

	async runExclusive<T>(callback: () => Promise<T>): Promise<T> {
		const release = await this.acquire()
		try {
			return await callback()
		} finally {
			release()
		}
	}
}

export type DbLayer = "domain" | "infrastructure" | "ui" | "plumbing"

type WhereCondition = {
	column: string
	value: string | number | string[] | number[] | null
	operator?: "=" | "<" | ">" | "<=" | ">=" | "!=" | "IN" | "LIKE" | "JSON_CONTAINS"
}

export type Increment = { _type: "increment"; value: number }

export type WriteOp = {
	type: "insert" | "update" | "delete" | "upsert"
	table: keyof Schema
	values?: Record<string, any | Increment>
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
	public static increment(value: number): Increment {
		return { _type: "increment", value }
	}

	private static readonly MAX_BUFFER_SIZE = 2000
	private static readonly MAX_RETRIES = 5
	private static readonly FLUSH_THRESHOLD = 50

	private globalBuffer: WriteOp[] = []
	private inFlightOps: WriteOp[] = []
	private retryCounts = new Map<string, number>()
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
			// Hardening: Enforce WAL mode and synchronous=NORMAL for stability/concurrency
			await sql`PRAGMA journal_mode=WAL`.execute(this.db)
			await sql`PRAGMA synchronous=NORMAL`.execute(this.db)
			await sql`PRAGMA busy_timeout=5000`.execute(this.db)
		}
		return this.db
	}

	private startFlushLoop() {
		if (this.flushInterval) return
		this.flushInterval = setInterval(() => this.flush().catch((e) => Logger.error("[DbPool] Flush loop error:", e)), 100)
		if (this.flushInterval.unref) {
			this.flushInterval.unref()
		}
	}

	public async beginWork(agentId: string) {
		await this.stateMutex.runExclusive(async () => {
			if (!this.agentShadows.has(agentId)) {
				this.agentShadows.set(agentId, { ops: [], affectedFiles: new Set() })
			}
		})
	}

	public getShadowOps(agentId: string): WriteOp[] {
		const shadow = this.agentShadows.get(agentId)
		return shadow ? [...shadow.ops] : []
	}

	public async getActiveAffectedFiles(): Promise<Map<string, string>> {
		return this.stateMutex.runExclusive(async () => {
			const activeFiles = new Map<string, string>()
			for (const [agentId, shadow] of this.agentShadows.entries()) {
				for (const file of shadow.affectedFiles) {
					activeFiles.set(file, agentId)
				}
			}
			return activeFiles
		})
	}

	public async push(op: WriteOp, agentId?: string, affectedFile?: string) {
		return this.pushBatch([op], agentId, affectedFile ? [affectedFile] : undefined)
	}

	public async pushBatch(ops: WriteOp[], agentId?: string, affectedFiles?: string[]) {
		let shouldFlush = false
		await this.stateMutex.runExclusive(async () => {
			if (agentId) {
				const shadow = this.agentShadows.get(agentId) || { ops: [], affectedFiles: new Set() }
				for (const op of ops) {
					shadow.ops.push({ ...op, agentId })
				}
				if (affectedFiles) {
					for (const file of affectedFiles) {
						shadow.affectedFiles.add(file)
					}
				}
				this.agentShadows.set(agentId, shadow)
			} else {
				if (this.globalBuffer.length + ops.length > BufferedDbPool.MAX_BUFFER_SIZE) {
					Logger.warn(`[DbPool] Buffer overflow (size: ${this.globalBuffer.length}), dropping ${ops.length} ops`)
					return
				}
				this.globalBuffer.push(...ops)
			}
			shouldFlush = this.globalBuffer.length >= BufferedDbPool.FLUSH_THRESHOLD
		})

		if (shouldFlush) {
			this.flush().catch((e) => Logger.error("[DbPool] Auto-flush error:", e))
		}
	}

	public async commitWork(
		agentId: string,
		_validator?: (affectedFiles: Set<string>, ops: WriteOp[]) => Promise<{ success: boolean; errors: string[] }>,
	) {
		await this.stateMutex.runExclusive(async () => {
			const shadow = this.agentShadows.get(agentId)
			if (!shadow || shadow.ops.length === 0) return

			if (_validator) {
				const { success, errors } = await _validator(shadow.affectedFiles, shadow.ops)
				if (!success) {
					throw new Error(`Commit validation failed: ${errors.join(", ")}`)
				}
			}

			if (this.globalBuffer.length + shadow.ops.length > BufferedDbPool.MAX_BUFFER_SIZE) {
				Logger.error(`[DbPool] Cannot commit: Buffer overflow risk for agent ${agentId}`)
				return
			}

			// Atomic move: and and clear shadow in one lock pulse
			this.globalBuffer.push(...shadow.ops)
			this.agentShadows.delete(agentId)

			if (this.globalBuffer.length >= BufferedDbPool.FLUSH_THRESHOLD) {
				this.flush().catch((e) => Logger.error("[DbPool] Commit-trigger flush error:", e))
			}
		})
	}

	public async rollbackWork(agentId: string, _reason?: string) {
		await this.stateMutex.runExclusive(async () => {
			this.agentShadows.delete(agentId)
		})
	}

	public async runTransaction<T>(callback: (agentId: string) => Promise<T>): Promise<T> {
		const agentId = `trx-${crypto.randomUUID()}`
		await this.beginWork(agentId)
		try {
			const result = await callback(agentId)
			await this.commitWork(agentId)
			return result
		} catch (e) {
			await this.rollbackWork(agentId, (e as Error).message)
			throw e
		}
	}

	public async flush() {
		return this.flushMutex.runExclusive(async () => {
			let opsToFlush: WriteOp[] = []

			await this.stateMutex.runExclusive(async () => {
				if (this.globalBuffer.length === 0) return

				opsToFlush = [...this.globalBuffer].sort((a, b) => {
					const pA = LAYER_PRIORITY[a.layer || "plumbing"]
					const pB = LAYER_PRIORITY[b.layer || "plumbing"]
					return pA - pB
				})
				this.globalBuffer = []
				this.inFlightOps = opsToFlush
			})

			if (opsToFlush.length === 0) return

			const db = await this.ensureDb()

			try {
				await db.transaction().execute(async (trx: any) => {
					for (let i = 0; i < opsToFlush.length; i++) {
						const op = opsToFlush[i]
						const conditions = normalizeWhere(op.where)

						// Group consecutive same-table inserts for bulk performance
						if (op.type === "insert" && op.values) {
							const batch = [op.values]
							while (
								i + 1 < opsToFlush.length &&
								opsToFlush[i + 1].type === "insert" &&
								opsToFlush[i + 1].table === op.table
							) {
								batch.push(opsToFlush[++i].values!)
							}
							await trx
								.insertInto(op.table as any)
								.values(batch as any)
								.execute()
							continue
						}

						// Group consecutive same-table upserts
						if (op.type === "upsert" && op.values) {
							const batch = [op.values]
							const conflictTarget = conditions.length > 0 ? conditions.map((c) => c.column) : ["id"]

							while (
								i + 1 < opsToFlush.length &&
								opsToFlush[i + 1].type === "upsert" &&
								opsToFlush[i + 1].table === op.table
							) {
								// Check if conflict target matches (simple check)
								const nextConds = normalizeWhere(opsToFlush[i + 1].where)
								const nextTarget = nextConds.length > 0 ? nextConds.map((c) => c.column) : ["id"]
								if (JSON.stringify(nextTarget) !== JSON.stringify(conflictTarget)) break

								batch.push(opsToFlush[++i].values!)
							}

							// Note: Increments in bulk upserts are complex, fall back to individual if detected
							const hasIncrements = batch.some((v) =>
								Object.values(v).some(
									(val) => val && typeof val === "object" && (val as any)._type === "increment",
								),
							)

							if (!hasIncrements) {
								await trx
									.insertInto(op.table as any)
									.values(batch as any)
									.onConflict((oc: any) =>
										oc.columns(conflictTarget).doUpdateSet((eb: any) => {
											const updateSet: any = {}
											if (batch.length > 0) {
												for (const key of Object.keys(batch[0])) {
													if (!conflictTarget.includes(key)) {
														updateSet[key] = eb.ref(`excluded.${key}`)
													}
												}
											}
											return updateSet
										}),
									)
									.execute()
								continue
							}
						}

						if (op.type === "upsert" && op.values) {
							const valuesWithNoIncrements: any = {}
							const increments: Record<string, number> = {}
							for (const [k, v] of Object.entries(op.values)) {
								if (v && typeof v === "object" && (v as any)._type === "increment") {
									increments[k] = (v as any).value
								} else {
									valuesWithNoIncrements[k] = v
								}
							}

							const query = trx
								.insertInto(op.table as any)
								.values(valuesWithNoIncrements as any)
								.onConflict((oc: any) => {
									const conflictTarget = conditions.length > 0 ? conditions.map((c) => c.column) : ["id"]
									const updateSet: any = { ...valuesWithNoIncrements }
									for (const [k, v] of Object.entries(increments)) {
										updateSet[k] = sql`${sql.ref(k)} + ${v}`
									}
									return oc.columns(conflictTarget).doUpdateSet(updateSet)
								})
							await query.execute()
						} else if (op.type === "update" && op.values) {
							let query = trx.updateTable(op.table as any)
							const sets: any = {}
							for (const [k, v] of Object.entries(op.values)) {
								if (v && typeof v === "object" && (v as any)._type === "increment") {
									sets[k] = sql`${sql.ref(k)} + ${v.value}`
								} else {
									sets[k] = v
								}
							}
							query = query.set(sets)
							for (const cond of conditions) {
								query = query.where(cond.column as any, "=", cond.value as any)
							}
							await query.execute()
						} else if (op.type === "delete") {
							let query = trx.deleteFrom(op.table as any)
							for (const cond of conditions) {
								const opStr = (cond.operator || "=").toLowerCase()
								query = query.where(cond.column as any, opStr as any, cond.value as any)
							}
							await query.execute()
						}
					}
				})

				await this.stateMutex.runExclusive(async () => {
					this.inFlightOps = []
					for (const op of opsToFlush) {
						const key = op.agentId || this.getOpSignature(op)
						this.retryCounts.delete(key)
					}
				})
			} catch (e: any) {
				const errorMsg = e instanceof Error ? e.message : String(e)
				const errorCode = (e as any).code || "UNKNOWN"
				Logger.error(`[DbPool] Flush failed (${errorCode}): ${errorMsg}`, e)

				await this.stateMutex.runExclusive(async () => {
					const toRequeue: WriteOp[] = []
					const toDrop: WriteOp[] = []

					for (const op of opsToFlush) {
						const key = op.agentId || this.getOpSignature(op)
						const retries = (this.retryCounts.get(key) || 0) + 1

						if (retries > BufferedDbPool.MAX_RETRIES) {
							toDrop.push(op)
						} else {
							this.retryCounts.set(key, retries)
							toRequeue.push(op)
						}
					}

					if (toDrop.length > 0) {
						Logger.error(
							`[DbPool] Dropping ${toDrop.length} poison-pill operations after ${BufferedDbPool.MAX_RETRIES} failures`,
						)
					}

					this.globalBuffer.unshift(...toRequeue)
					this.inFlightOps = []
				})
			}
		})
	}

	private getOpSignature(op: WriteOp): string {
		return crypto.createHash("md5").update(JSON.stringify(op)).digest("hex")
	}

	public async selectAllFrom<T extends keyof Schema>(table: T, agentId?: string): Promise<Schema[T][]> {
		return this.selectWhere(table, [], agentId)
	}

	public async selectWhere<T extends keyof Schema>(
		table: T,
		where: WhereCondition | WhereCondition[],
		agentId?: string,
		options?: {
			orderBy?: { column: keyof Schema[T]; direction: "asc" | "desc" }
			limit?: number
		},
	): Promise<Schema[T][]> {
		return this.stateMutex.runExclusive(async () => {
			const db = await this.ensureDb()
			const conditions = normalizeWhere(where)

			let query = db.selectFrom(table as any).selectAll()
			for (const cond of conditions) {
				const opStr = (cond.operator || "=").toLowerCase()
				if (Array.isArray(cond.value)) {
					query = query.where(cond.column as any, "in", cond.value as any)
				} else if (opStr === "json_contains") {
					query = query.where(
						sql`EXISTS (SELECT 1 FROM json_each(${sql.ref(cond.column)}) WHERE value = ${cond.value})` as any,
					)
				} else {
					query = query.where(cond.column as any, opStr as any, cond.value as any)
				}
			}

			if (options?.orderBy) {
				query = query.orderBy(options.orderBy.column as any, options.orderBy.direction)
			}
			if (options?.limit) {
				query = query.limit(options.limit)
			}

			const diskResults = (await query.execute()) as Schema[T][]

			const applyOps = (ops: WriteOp[], base: Schema[T][]) => {
				let results = [...base]
				for (const op of ops) {
					if (op.table !== table) continue

					if ((op.type === "insert" || op.type === "upsert") && op.values) {
						const rec = op.values as unknown as Schema[T]
						const upsertConds = normalizeWhere(op.where)
						const pkMatch = (r: any) => {
							if (upsertConds.length > 0) {
								return upsertConds.every((c) => r[c.column] === c.value)
							}
							if ((r as any).id && (rec as any).id) return r.id === (rec as any).id
							return false
						}
						const existingIdx = results.findIndex(pkMatch)
						if (existingIdx >= 0) {
							results[existingIdx] = { ...results[existingIdx], ...rec }
						} else {
							// Filter-on-Read: Check if the inserted item matches the query conditions
							const match = upsertConds.every((c) => {
								const val = (rec as any)[c.column]
								const op = (c.operator || "=").toUpperCase()
								if (op === "=") return val === c.value
								if (op === "IN") return Array.isArray(c.value) && (c.value as any[]).includes(val)
								return false
							})
							if (match || upsertConds.length === 0) {
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
							const match = updConds.every((c) => {
								const val = rec[c.column]
								const opStr = (c.operator || "=").toLowerCase()
								if (opStr === "=") return val === c.value
								if (opStr === "!=") return val !== c.value
								if (opStr === ">") return (val as any) > (c.value as any)
								if (opStr === "<") return (val as any) < (c.value as any)
								if (opStr === ">=") return (val as any) >= (c.value as any)
								if (opStr === "<=") return (val as any) <= (c.value as any)
								if (opStr === "in" && Array.isArray(c.value)) return (c.value as any[]).includes(val as any)
								if (opStr === "like" && typeof val === "string" && typeof c.value === "string") {
									const regex = new RegExp(c.value.replace(/%/g, ".*"), "i")
									return regex.test(val)
								}
								if (opStr === "json_contains" && typeof val === "string") {
									try {
										const arr = JSON.parse(val)
										return Array.isArray(arr) && arr.includes(c.value)
									} catch {
										return false
									}
								}
								return false
							})
							if (match) {
								return { ...r, ...op.values } as unknown as Schema[T]
							}
							return r
						})
					}
				}
				return results
			}

			let finalResults = applyOps(this.inFlightOps, diskResults)
			finalResults = applyOps(this.globalBuffer, finalResults)
			if (agentId) {
				const shadow = this.agentShadows.get(agentId)
				if (shadow) {
					finalResults = applyOps(shadow.ops, finalResults)
				}
			}

			// Final pass for sorting/limiting on merged results
			if (options?.orderBy) {
				const col = options.orderBy.column as string
				const dir = options.orderBy.direction
				finalResults.sort((a: any, b: any) => {
					if (a[col] < b[col]) return dir === "asc" ? -1 : 1
					if (a[col] > b[col]) return dir === "asc" ? 1 : -1
					return 0
				})
			}
			if (options?.limit) {
				finalResults = finalResults.slice(0, options.limit)
			}

			return finalResults
		})
	}

	public async selectOne<T extends keyof Schema>(
		table: T,
		where: WhereCondition | WhereCondition[],
		agentId?: string,
	): Promise<Schema[T] | null> {
		const results = await this.selectWhere(table, where, agentId)
		return results.length > 0 ? (results[results.length - 1] as Schema[T]) : null
	}

	public async executeQuery(query: string, params: any[]): Promise<any[]> {
		const db = await this.ensureDb()
		return await sql`${sql.raw(query)}`.execute(db as any).then((r) => r.rows)
	}

	public async stop() {
		if (this.flushInterval) {
			clearInterval(this.flushInterval)
			this.flushInterval = null
		}
		await this.flush()
	}
}

export const dbPool = new BufferedDbPool()
