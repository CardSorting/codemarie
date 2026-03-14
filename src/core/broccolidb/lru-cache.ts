interface CacheEntry<V> {
	value: V
	timestamp: number
}

export class LRUCache<K, V> {
	private readonly capacity: number
	private readonly ttlMs: number
	private cache: Map<K, CacheEntry<V>>
	private pruneInterval?: NodeJS.Timeout
	private _hits = 0
	private _misses = 0

	constructor(capacity: number, ttlMs = 0) {
		if (capacity <= 0) throw new Error("Capacity must be greater than 0")
		this.capacity = capacity
		this.ttlMs = ttlMs
		this.cache = new Map<K, CacheEntry<V>>()

		if (this.ttlMs > 0) {
			this.pruneInterval = setInterval(() => this.prune(), Math.min(this.ttlMs, 600000))
			if (this.pruneInterval.unref) {
				this.pruneInterval.unref()
			}
		}
	}

	private prune(): void {
		const now = Date.now()
		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > this.ttlMs) {
				this.cache.delete(key)
			}
		}
	}

	get(key: K): V | undefined {
		const entry = this.cache.get(key)
		if (entry === undefined) {
			this._misses++
			return undefined
		}

		if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key)
			this._misses++
			return undefined
		}

		this._hits++
		// Refresh insertion order
		this.cache.delete(key)
		this.cache.set(key, entry)
		return entry.value
	}

	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key)
		} else if (this.cache.size >= this.capacity) {
			const lruKey = this.cache.keys().next().value
			if (lruKey !== undefined) {
				this.cache.delete(lruKey)
			}
		}
		this.cache.set(key, { value, timestamp: Date.now() })
	}

	has(key: K): boolean {
		const entry = this.cache.get(key)
		if (!entry) return false
		if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key)
			return false
		}
		return true
	}

	/**
	 * Retrieve value without updating LRU order.
	 */
	peek(key: K): V | undefined {
		const entry = this.cache.get(key)
		if (!entry) return undefined
		if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key)
			return undefined
		}
		return entry.value
	}

	delete(key: K): boolean {
		return this.cache.delete(key)
	}

	clear(): void {
		this.cache.clear()
		this._hits = 0
		this._misses = 0
	}

	dispose(): void {
		if (this.pruneInterval) {
			clearInterval(this.pruneInterval)
		}
	}

	get size(): number {
		return this.cache.size
	}

	get hits(): number {
		return this._hits
	}

	get misses(): number {
		return this._misses
	}
}
