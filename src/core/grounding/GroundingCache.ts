interface CacheEntry<V> {
	value: V
	timestamp: number
}

/**
 * A hardened LRU (Least Recently Used) cache implementation with TTL and key hashing.
 * Uses Map's insertion order to maintain LRU property efficiently.
 */
export class LRUCache<V> {
	private cache = new Map<string, CacheEntry<V>>()
	private readonly capacity: number
	private readonly ttlMs: number
	private pruneInterval?: NodeJS.Timeout

	constructor(capacity: number, ttlMs = 0) {
		this.capacity = capacity
		this.ttlMs = ttlMs

		// Hardening: Periodic pruning to avoid memory leaks from expired but unaccessed entries
		if (this.ttlMs > 0) {
			this.pruneInterval = setInterval(() => this.prune(), Math.min(this.ttlMs, 600000))
			// Ensure interval doesn't keep process alive in environments like VSCode extension host
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

	get(key: string): V | undefined {
		const entry = this.cache.get(key)
		if (entry === undefined) return undefined

		// TTL check
		if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key)
			return undefined
		}

		// Move to end (most recently used)
		this.cache.delete(key)
		this.cache.set(key, entry)
		return entry.value
	}

	/**
	 * Check if key exists without updating LRU order.
	 */
	has(key: string): boolean {
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
	peek(key: string): V | undefined {
		const entry = this.cache.get(key)
		if (!entry) return undefined
		if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key)
			return undefined
		}
		return entry.value
	}

	set(key: string, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key)
		} else if (this.cache.size >= this.capacity) {
			const oldestKey = this.cache.keys().next().value
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey)
			}
		}
		this.cache.set(key, { value, timestamp: Date.now() })
	}

	clear(): void {
		this.cache.clear()
	}

	dispose(): void {
		if (this.pruneInterval) {
			clearInterval(this.pruneInterval)
		}
	}
}
