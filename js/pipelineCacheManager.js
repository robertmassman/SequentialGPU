class PipelineCacheManager {
    constructor(device) {
        this.device = device;
        this.shaderCache = new Map();
        this.pipelineCache = new Map();
        this.layoutCache = new Map();

        // Enhanced performance metrics
        this.stats = {
            // Compilation stats
            shadersCompiled: 0,
            pipelinesCreated: 0,
            pipelinesReused: 0,
            layoutsCreated: 0,
            layoutsReused: 0,
            cacheHits: 0,
            cacheMisses: 0,

            // Timing metrics
            averageCompilationTime: 0,
            totalCompilationTime: 0,
            lastCompilationTime: 0,

            // Memory metrics
            currentCacheSize: 0,
            peakCacheSize: 0,

            // Cache efficiency
            hitRate: 0,
            missRate: 0,

            // Timestamps
            lastUpdate: Date.now(),
            startTime: Date.now()
        };

        // LRU cache configuration
        this.maxCacheSize = 100;
        this.lruList = new Map();
    }

    /**
     * Maintains cache size within limits using LRU policy
     * @private
     */
    _maintainCacheSize() {
        if (this.shaderCache.size > this.maxCacheSize) {
            // Sort entries by last used time
            const sortedEntries = [...this.lruList.entries()]
                .sort(([, timeA], [, timeB]) => timeA - timeB);

            // Remove oldest entries until we're back to maxCacheSize
            while (this.shaderCache.size > this.maxCacheSize) {
                const [oldestKey] = sortedEntries.shift();
                this.shaderCache.delete(oldestKey);
                this.lruList.delete(oldestKey);
            }
        }
    }

    /**
     * Simple string hashing function
     * @private
     */
    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    /**
     * Clears all caches
     */
    dispose() {
        this.shaderCache.clear();
        this.pipelineCache.clear();
        this.layoutCache.clear();
        this.lruList.clear();
    }

    storeCacheState() {
        return {
            pipelines: Array.from(this.pipelineCache.entries()),
            layouts: Array.from(this.layoutCache.entries()),
            stats: { ...this.stats }
        };
    }

    async restoreCacheState(previousState, newDimensions) {
        // Filter and restore compatible cache entries
        for (const [key, entry] of previousState.pipelines) {
            if (this.isCompatibleWithDimensions(entry, newDimensions)) {
                this.pipelineCache.set(key, entry);
            }
        }

        for (const [key, entry] of previousState.layouts) {
            if (this.isCompatibleLayout(entry, newDimensions)) {
                this.layoutCache.set(key, entry);
            }
        }

        // Update stats
        this.stats = {
            ...this.stats,
            pipelinesReused: this.pipelineCache.size,
            layoutsReused: this.layoutCache.size
        };
    }

    isCompatibleWithDimensions(entry, dimensions) {
        // Check if pipeline/layout is compatible with new dimensions
        return entry.metadata &&
            (!entry.metadata.dimensions || // No dimension requirements
                (entry.metadata.dimensions.width <= dimensions.width &&
                    entry.metadata.dimensions.height <= dimensions.height));
    }

    isCompatibleLayout(entry, dimensions) {
        // Additional layout-specific compatibility checks
        return this.isCompatibleWithDimensions(entry, dimensions) &&
            entry.layout && !entry.layout.destroyed;
    }

    ///////////////
    _updatePerformanceMetrics(params) {
        const now = Date.now();
        const {
            operationType,    // 'shader', 'pipeline', or 'layout'
            operation,       // 'create', 'reuse', or 'compile'
            duration = 0,    // Time taken for operation
            size = 0         // Size of cached item (if applicable)
        } = params;

        // Update operation counts
        switch (`${operationType}_${operation}`) {
            case 'shader_compile':
                this.stats.shadersCompiled++;
                this.stats.totalCompilationTime += duration;
                this.stats.lastCompilationTime = duration;
                this.stats.averageCompilationTime = this.stats.totalCompilationTime / this.stats.shadersCompiled;
                break;

            case 'pipeline_create':
                this.stats.pipelinesCreated++;
                this.stats.cacheMisses++;
                break;

            case 'pipeline_reuse':
                this.stats.pipelinesReused++;
                this.stats.cacheHits++;
                break;

            case 'layout_create':
                this.stats.layoutsCreated++;
                break;

            case 'layout_reuse':
                this.stats.layoutsReused++;
                break;
        }

        // Update cache efficiency metrics
        const totalOperations = this.stats.cacheHits + this.stats.cacheMisses;
        if (totalOperations > 0) {
            this.stats.hitRate = this.stats.cacheHits / totalOperations;
            this.stats.missRate = this.stats.cacheMisses / totalOperations;
        }

        // Update memory metrics
        this.stats.currentCacheSize =
            this.shaderCache.size +
            this.pipelineCache.size +
            this.layoutCache.size;

        this.stats.peakCacheSize = Math.max(
            this.stats.peakCacheSize,
            this.stats.currentCacheSize
        );

        // Update timestamps
        this.stats.lastUpdate = now;
    }

    async getShaderModule(code) {
        const shaderKey = this._hashString(code);

        if (!this.shaderCache.has(shaderKey)) {
            const startTime = performance.now();

            // Create and validate shader module
            const module = this.device.createShaderModule({ code });

            try {
                const compilationInfo = await module.getCompilationInfo();
                if (compilationInfo.messages.some(msg => msg.type === 'error')) {
                    throw new Error(`Shader compilation failed: ${compilationInfo.messages.map(m => m.message).join('\n')}`);
                }
            } catch (error) {
                console.error('Shader compilation error:', error);
                throw error;
            }

            const duration = performance.now() - startTime;

            this.shaderCache.set(shaderKey, module);

            // Update metrics for shader compilation
            this._updatePerformanceMetrics({
                operationType: 'shader',
                operation: 'compile',
                duration,
                size: code.length
            });

            this._maintainCacheSize();
        } else {
            // Update metrics for shader cache hit
            this._updatePerformanceMetrics({
                operationType: 'shader',
                operation: 'reuse'
            });
        }

        this.lruList.set(shaderKey, Date.now());
        return this.shaderCache.get(shaderKey);
    }

    getCacheStats() {
        return {
            ...this.stats,
            cacheSize: {
                shaders: this.shaderCache.size,
                pipelines: this.pipelineCache.size,
                layouts: this.layoutCache.size,
                total: this.stats.currentCacheSize
            },
            efficiency: {
                hitRate: this.stats.hitRate.toFixed(2),
                missRate: this.stats.missRate.toFixed(2),
                averageCompilationTime: `${this.stats.averageCompilationTime.toFixed(2)}ms`
            },
            uptime: Date.now() - this.stats.startTime
        };
    }

    getCachePerformance() {
        return {
            cacheStats: {
                hits: this.stats.cacheHits,
                misses: this.stats.cacheMisses,
                hitRate: this.stats.hitRate,
                missRate: this.stats.missRate
            },
            performanceStats: {
                averageCompilationTime: this.stats.averageCompilationTime,
                totalCompilationTime: this.stats.totalCompilationTime,
                lastCompilationTime: this.stats.lastCompilationTime
            },
            memoryStats: {
                currentSize: this.stats.currentCacheSize,
                peakSize: this.stats.peakCacheSize
            },
            timestamps: {
                lastUpdate: this.stats.lastUpdate,
                uptime: Date.now() - this.stats.startTime
            }
        };
    }

}

export default PipelineCacheManager