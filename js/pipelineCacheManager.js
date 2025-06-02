import GPUUtils from './gpuUtils.js';

class PipelineCacheManager {
    constructor(app) {
        this.app = app; // Store reference to app
        this.device = app.device;

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
    /*_hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }*/
    _hashString(str) {
        return GPUUtils.hashString(str);
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

    ////////// NEW
    /**
    * Creates a shader module with enhanced error handling
    * @param {string} code - The shader code
    * @param {Object} options - Additional options
    * @param {string} options.label - Label for shader module
    * @returns {Promise<GPUShaderModule>} The shader module
    */
    async getShaderModule(code, options = {}) {
        const shaderKey = this._hashString(code);
        const { label = 'Unknown Shader' } = options; // Remove fallbackId parameter

        if (!this.shaderCache.has(shaderKey)) {
            const startTime = performance.now();

            // Create shader module
            const module = this.device.createShaderModule({
                code,
                label: `${label} Shader Module`
            });

            try {
                // Check for compilation errors
                const compilationInfo = await module.getCompilationInfo();
                const errors = compilationInfo.messages.filter(msg => msg.type === 'error');
                const warnings = compilationInfo.messages.filter(msg => msg.type === 'warning');

                // Log warnings but continue
                if (warnings.length > 0) {
                    console.warn(`Shader warnings in ${label}:`,
                        warnings.map(w => this._formatShaderMessage(w)).join('\n'));
                }

                // If we have errors, throw detailed error with specific error type
                if (errors.length > 0) {
                    const errorDetails = this._formatShaderErrors(errors, code, label);
                    console.error(`Shader compilation failed for ${label}:`, errorDetails);

                    // Create a special error type that can be identified
                    const error = new Error(`Shader compilation failed: ${errorDetails.summary}`);
                    error.name = 'ShaderCompilationError';
                    error.details = errorDetails;
                    throw error;
                }
            } catch (error) {

                const errorInfo = {
                    label: label || shaderURL,
                    summary: `Failed to compile shader: ${error.message}`,
                    details: this._formatErrorDetails(error),
                    errorCount: 1
                };

                // Rethrow to allow graceful handling upstream
                throw new Error(`ShaderCompilationError: ${errorInfo}`);
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
        }

        this.lruList.set(shaderKey, Date.now());
        return this.shaderCache.get(shaderKey);
    }

    _formatErrorDetails(error) {
        // Format details array with line numbers if available
        if (error.lineNum && error.linePos) {
            return [
                `Error at line ${error.lineNum}, position ${error.linePos}`,
                error.message
            ];
        }
        return [error.message];
    }

    /**
     * Formats shader compilation errors with context
     * @private
     */
    /*_formatShaderErrors(errors, code, label) {
        const lines = code.split('\n');
        const formattedErrors = errors.map(error => this._formatShaderMessage(error, lines));

        return {
            summary: errors.map(e => e.message).join('\n'),
            details: formattedErrors,
            errorCount: errors.length,
            label
        };
    }*/
    _formatShaderErrors(errors, code, label) {
        return GPUUtils.formatShaderErrors(errors, code, label);
    }

    /**
     * Formats a single shader compilation message with line context
     * @private
     */
    /*_formatShaderMessage(message, codeLines = []) {
        const { lineNum, linePos, offset, length, message: msg, type } = message;

        let formattedMsg = `[${type.toUpperCase()}] Line ${lineNum}:${linePos} - ${msg}`;

        // Add code context if we have the code lines
        if (codeLines.length > 0 && lineNum > 0 && lineNum <= codeLines.length) {
            const line = codeLines[lineNum - 1];
            const pointer = ' '.repeat(linePos - 1) + '^'.repeat(Math.max(1, length));
            formattedMsg += `\n${line}\n${pointer}`;
        }

        return formattedMsg;
    }*/
    _formatShaderMessage(message, codeLines = []) {
        return GPUUtils.formatShaderMessage(message, codeLines);
    }
    //////////////

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