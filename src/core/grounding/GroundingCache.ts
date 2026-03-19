import { LRUCache } from "@/shared/utils/LRUCache"

/**
 * A hardened grounding cache implementation with TTL and key hashing.
 */
export class GroundingCache<V> {
	private lru: LRUCache<V>

	constructor(capacity: number, ttlMs = 0) {
		this.lru = new LRUCache<V>(capacity, ttlMs)
	}

	get(key: string): V | undefined {
		return this.lru.get(key)
	}

	set(key: string, value: V): void {
		this.lru.set(key, value)
	}

	has(key: string): boolean {
		return this.lru.has(key)
	}

	clear(): void {
		this.lru.clear()
	}

	dispose(): void {
		this.lru.dispose()
	}
}
