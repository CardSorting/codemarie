export declare class LRUCache<K, V> {
	private capacity
	private cache
	private _hits
	private _misses
	constructor(capacity: number)
	get(key: K): V | undefined
	set(key: K, value: V): void
	has(key: K): boolean
	delete(key: K): boolean
	clear(): void
	get size(): number
	get hits(): number
	get misses(): number
}
//# sourceMappingURL=lru-cache.d.ts.map
