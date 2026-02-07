/**
 * LRU Cache for storing analysis results with configurable size
 */
export class IndexCache {
    private cache = new Map<string, { value: unknown; timestamp: number }>();
    private maxSize: number;

    constructor(maxSize: number = 100) {
        this.maxSize = maxSize;
    }

    /**
     * Get a cached value
     */
    get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.value as T;
    }

    /**
     * Set a cached value
     */
    set<T>(key: string, value: T): void {
        // Remove oldest entries if at capacity
        while (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    /**
     * Check if a key exists in cache
     */
    has(key: string): boolean {
        return this.cache.has(key);
    }

    /**
     * Delete a specific key
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Invalidate all entries that start with a prefix
     */
    invalidateByPrefix(prefix: string): void {
        const keysToDelete: string[] = [];

        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.cache.delete(key);
        }
    }

    /**
     * Clear the entire cache
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get the current cache size
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Get cache statistics
     */
    getStats(): { size: number; maxSize: number } {
        return {
            size: this.cache.size,
            maxSize: this.maxSize
        };
    }
}
