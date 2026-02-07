import { describe, it, expect, beforeEach } from 'vitest';
import { IndexCache } from './indexCache';

describe('IndexCache', () => {
    let cache: IndexCache;

    beforeEach(() => {
        cache = new IndexCache(3); // Small cache for testing
    });

    describe('get/set', () => {
        it('should store and retrieve values', () => {
            cache.set('key1', 'value1');
            expect(cache.get('key1')).toBe('value1');
        });

        it('should return null for missing keys', () => {
            expect(cache.get('nonexistent')).toBeNull();
        });

        it('should update existing values', () => {
            cache.set('key1', 'value1');
            cache.set('key1', 'value2');
            expect(cache.get('key1')).toBe('value2');
        });

        it('should handle complex objects', () => {
            const obj = { foo: 'bar', nested: { value: 123 } };
            cache.set('complex', obj);
            expect(cache.get('complex')).toEqual(obj);
        });
    });

    describe('LRU eviction', () => {
        it('should evict oldest entry when at capacity', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            cache.set('key4', 'value4'); // Should evict key1

            expect(cache.get('key1')).toBeNull();
            expect(cache.get('key2')).toBe('value2');
            expect(cache.get('key3')).toBe('value3');
            expect(cache.get('key4')).toBe('value4');
        });

        it('should move accessed entries to end', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');

            // Access key1, making it most recently used
            cache.get('key1');

            // Add new entry, should evict key2 (oldest)
            cache.set('key4', 'value4');

            expect(cache.get('key1')).toBe('value1');
            expect(cache.get('key2')).toBeNull();
        });
    });

    describe('invalidateByPrefix', () => {
        it('should delete entries matching prefix', () => {
            cache.set('usages:file1:10', 'value1');
            cache.set('usages:file1:20', 'value2');
            cache.set('usages:file2:10', 'value3');

            cache.invalidateByPrefix('usages:file1');

            expect(cache.get('usages:file1:10')).toBeNull();
            expect(cache.get('usages:file1:20')).toBeNull();
            expect(cache.get('usages:file2:10')).toBe('value3');
        });
    });

    describe('clear', () => {
        it('should remove all entries', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');

            cache.clear();

            expect(cache.size).toBe(0);
            expect(cache.get('key1')).toBeNull();
        });
    });

    describe('size', () => {
        it('should return current cache size', () => {
            expect(cache.size).toBe(0);
            cache.set('key1', 'value1');
            expect(cache.size).toBe(1);
            cache.set('key2', 'value2');
            expect(cache.size).toBe(2);
        });
    });

    describe('getStats', () => {
        it('should return cache statistics', () => {
            cache.set('key1', 'value1');
            const stats = cache.getStats();

            expect(stats.size).toBe(1);
            expect(stats.maxSize).toBe(3);
        });
    });

    describe('has', () => {
        it('should return true for existing keys', () => {
            cache.set('key1', 'value1');
            expect(cache.has('key1')).toBe(true);
        });

        it('should return false for missing keys', () => {
            expect(cache.has('nonexistent')).toBe(false);
        });
    });

    describe('delete', () => {
        it('should remove specific key', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');

            const result = cache.delete('key1');

            expect(result).toBe(true);
            expect(cache.get('key1')).toBeNull();
            expect(cache.get('key2')).toBe('value2');
        });

        it('should return false for missing key', () => {
            const result = cache.delete('nonexistent');
            expect(result).toBe(false);
        });
    });
});
