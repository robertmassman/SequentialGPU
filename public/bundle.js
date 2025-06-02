/**
 * Centralized utility class for common WebGPU operations
 * Eliminates code duplication across managers
 */
class GPUUtils {
    // Static hash function used across the codebase
    static hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    /**
     * Creates a standard sampler with consistent settings
     * @param {GPUDevice} device - WebGPU device
     * @param {Object} options - Optional sampler configuration
     * @returns {GPUSampler} Configured sampler
     */
    static createStandardSampler(device, options = {}) {
        return device.createSampler({
            magFilter: options.magFilter || 'linear',
            minFilter: options.minFilter || 'linear',
            wrapU: options.wrapU || 'clamp-to-edge',
            wrapV: options.wrapV || 'clamp-to-edge',
            ...options
        });
    }

    /**
     * Generates a consistent bind group layout key
     * @param {Object} filter - Filter configuration
     * @param {Object} pass - Pass configuration
     * @returns {string} Hashed layout key
     */
    static generateBindGroupLayoutKey(filter, pass) {
        const keyComponents = {
            type: filter.type,
            inputTextureCount: pass.inputTexture?.length || 0,
            hasBuffer: !!filter.bufferAttachment?.bindings,
            bufferType: filter.type === 'compute' ? 'storage' : 'uniform',
            bindingIndex: filter.bufferAttachment?.bindingIndex
        };
        return this.hashString(JSON.stringify(keyComponents));
    }

    /**
     * Generates a detailed pipeline key for caching
     * @param {Object} config - Pipeline configuration
     * @returns {string} Hashed pipeline key
     */
    static generatePipelineKey(config) {
        const keyComponents = {
            type: config.type,
            shader: config.shaderURL,
            format: config.presentationFormat,
            sampleCount: config.sampleCount,
            layoutEntries: config.bindGroupLayout?.map(entry => ({
                binding: entry.binding,
                visibility: entry.visibility,
                bufferType: entry.buffer?.type,
                textureFormat: entry.texture?.format,
                samplerType: entry.sampler?.type,
                viewDimension: entry.texture?.viewDimension
            })),
            vertex: config.type !== 'compute' ? {
                buffers: [
                    {
                        arrayStride: 8,
                        stepMode: 'vertex',
                        attributes: [
                            { format: 'float32x2', offset: 0, shaderLocation: 0 }
                        ]
                    },
                    {
                        arrayStride: 8,
                        stepMode: 'vertex',
                        attributes: [
                            { format: 'float32x2', offset: 0, shaderLocation: 1 }
                        ]
                    }
                ],
                entryPoint: 'vs'
            } : undefined,
            fragment: config.type !== 'compute' ? {
                targets: [{ format: config.presentationFormat }],
                entryPoint: 'fs'
            } : undefined,
            compute: config.type === 'compute' ? {
                entryPoint: 'main'
            } : undefined,
            multisample: config.type !== 'compute' ? {
                count: config.sampleCount,
                mask: 0xFFFFFFFF,
                alphaToCoverageEnabled: false
            } : undefined
        };

        const sortedKey = JSON.stringify(keyComponents, Object.keys(keyComponents).sort());
        return this.hashString(sortedKey);
    }

    /**
     * Creates standardized bind group entries
     * @param {Object} options - Configuration options
     * @returns {Array} Bind group entries array
     */
    static createStandardBindGroupEntries(options) {
        const {
            device,
            textureManager,
            filter,
            pass,
            bufferResource,
            visibility = filter.type === 'compute' ? GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT
        } = options;

        const entries = [];

        // Add sampler binding (always binding 0)
        entries.push({
            binding: 0,
            resource: this.createStandardSampler(device)
        });

        // Add texture bindings
        if (pass.inputTexture?.length) {
            pass.inputTexture.forEach((textureName, index) => {
                const textureView = textureManager.getTexture(textureName)?.createView();
                if (!textureView) {
                    throw new Error(`Texture ${textureName} not found`);
                }
                entries.push({
                    binding: index + 1,
                    resource: textureView
                });
            });
        }

        // Add buffer binding if needed
        if (filter.bufferAttachment?.bindings && bufferResource?.buffer) {
            entries.push({
                binding: filter.bufferAttachment.bindingIndex || 3,
                resource: {
                    buffer: bufferResource.buffer,
                    offset: 0,
                    size: bufferResource.buffer.size
                }
            });
        }

        return entries;
    }

    /**
     * Creates standardized bind group layout entries
     * @param {Object} options - Configuration options
     * @returns {Array} Layout entries array
     */
    static createStandardLayoutEntries(options) {
        const {
            filter,
            pass,
            visibility = filter.type === 'compute' ? GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT
        } = options;

        const entries = [];

        // Add sampler binding
        entries.push({
            binding: 0,
            visibility,
            sampler: { type: 'filtering' }
        });

        // Add texture bindings
        if (pass.inputTexture && Array.isArray(pass.inputTexture)) {
            pass.inputTexture.forEach((_, index) => {
                entries.push({
                    binding: index + 1,
                    visibility,
                    texture: { sampleType: 'float' }
                });
            });
        }

        // Add buffer binding if needed
        if (filter.bufferAttachment?.bindings) {
            entries.push({
                binding: filter.bufferAttachment.bindingIndex || 3,
                visibility,
                buffer: {
                    type: filter.type === 'compute' ? 'storage' : 'uniform'
                }
            });
        }

        return entries;
    }

    /**
     * Standardized error handling with consistent formatting
     * @param {string} component - Component name where error occurred
     * @param {string} operation - Operation that failed
     * @param {Error} error - The error object
     * @param {Object} context - Additional context information
     */
    static handleError(component, operation, error, context = {}) {
        const timestamp = new Date().toISOString();
        const errorInfo = {
            timestamp,
            component,
            operation,
            message: error.message,
            context
        };

        console.error(`[${timestamp}] [${component}] Failed ${operation}:`, errorInfo);
        
        // Return standardized error for upstream handling
        const standardError = new Error(`${component}: ${operation} failed - ${error.message}`);
        standardError.originalError = error;
        standardError.context = context;
        return standardError;
    }

    /**
     * Validates texture format compatibility
     * @param {string} format - Texture format to validate
     * @returns {boolean} Whether format is valid
     */
    static validateTextureFormat(format) {
        const validFormats = [
            'rgba8unorm', 'rgba8unorm-srgb', 'rgba8snorm',
            'rgba16float', 'rgba32float',
            'bgra8unorm', 'bgra8unorm-srgb',
            'r8unorm', 'rg8unorm', 'rg16float', 'rg32float'
        ];
        return validFormats.includes(format);
    }

    /**
     * Calculates appropriate buffer size with alignment
     * @param {number} size - Desired buffer size
     * @param {number} alignment - Alignment requirement (default: 16)
     * @returns {number} Aligned buffer size
     */
    static calculateAlignedBufferSize(size, alignment = 16) {
        return Math.ceil(size / alignment) * alignment;
    }

    /**
     * Creates a tracked buffer with consistent settings
     * @param {GPUDevice} device - WebGPU device
     * @param {Object} descriptor - Buffer descriptor
     * @param {Set} resourceTracker - Resource tracking set
     * @returns {GPUBuffer} Created buffer
     */
    static createTrackedBuffer(device, descriptor, resourceTracker = null) {
        const buffer = device.createBuffer(descriptor);
        
        if (resourceTracker) {
            resourceTracker.add(buffer);
        }
        
        return buffer;
    }

    /**
     * Formats shader compilation errors consistently
     * @param {Array} errors - Array of compilation errors
     * @param {string} code - Shader source code
     * @param {string} label - Shader label
     * @returns {Object} Formatted error information
     */
    static formatShaderErrors(errors, code, label) {
        const lines = code.split('\n');
        const formattedErrors = errors.map(error => this.formatShaderMessage(error, lines));

        return {
            summary: errors.map(e => e.message).join('\n'),
            details: formattedErrors,
            errorCount: errors.length,
            label
        };
    }

    /**
     * Formats a single shader compilation message with context
     * @param {Object} message - Compilation message
     * @param {Array} codeLines - Source code lines
     * @returns {string} Formatted message
     */
    static formatShaderMessage(message, codeLines = []) {
        const { lineNum, linePos, offset, length, message: msg, type } = message;

        let formattedMsg = `[${type.toUpperCase()}] Line ${lineNum}:${linePos} - ${msg}`;

        if (codeLines.length > 0 && lineNum > 0 && lineNum <= codeLines.length) {
            const line = codeLines[lineNum - 1];
            const pointer = ' '.repeat(linePos - 1) + '^'.repeat(Math.max(1, length));
            formattedMsg += `\n${line}\n${pointer}`;
        }

        return formattedMsg;
    }

    /**
     * Determines if two bind group layouts are compatible
     * @param {Object} layout1 - First layout
     * @param {Object} layout2 - Second layout
     * @returns {boolean} Whether layouts are compatible
     */
    static areLayoutsCompatible(layout1, layout2) {
        if (!layout1.entries || !layout2.entries) return false;
        if (layout1.entries.length !== layout2.entries.length) return false;

        return layout1.entries.every((entry1, index) => {
            const entry2 = layout2.entries[index];
            return entry1.binding === entry2.binding &&
                   entry1.visibility === entry2.visibility &&
                   JSON.stringify(entry1.buffer) === JSON.stringify(entry2.buffer) &&
                   JSON.stringify(entry1.texture) === JSON.stringify(entry2.texture) &&
                   JSON.stringify(entry1.sampler) === JSON.stringify(entry2.sampler);
        });
    }

    /**
     * Safely destroys a WebGPU resource
     * @param {Object} resource - Resource to destroy
     * @param {string} resourceType - Type of resource for logging
     */
    static safeDestroy(resource, resourceType = 'resource') {
        try {
            if (resource && !resource.destroyed && typeof resource.destroy === 'function') {
                resource.destroy();
            }
        } catch (error) {
            console.warn(`Error destroying ${resourceType}:`, error);
        }
    }

    /**
     * Creates a debounced function for performance optimization
     * @param {Function} func - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @returns {Function} Debounced function
     */
    static debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }
}

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

class PipelineManager {
    constructor(app) {
        this.device = app.device;
        this.presentationFormat = app.presentationFormat;
        this.bufferManager = app.bufferManager;
        this.textureManager = app.textureManager;
        this.shaderCache = new Map();
        this.pipelineCacheManager = new PipelineCacheManager(app);
    }

    async loadShader(url) {
        try {
            if (!this.shaderCache.has(url)) {
                const response = await fetch(url);
                const code = await response.text();
                this.shaderCache.set(url, code);
            }
            return this.shaderCache.get(url);
        } catch (error) {
            console.error(`Failed to load shader from ${url}`);
            throw error;
        }


    }

    getCacheStats() {
        return {
            ...this.pipelineCacheManager.getStats(),
            shaderURLCacheSize: this.shaderCache.size
        };
    }

    dispose() {
        this.pipelineCacheManager.dispose();
        this.shaderCache.clear();
    }

    async _performCacheMaintenance() {
        // Implement cache size limits
        const MAX_CACHE_SIZE = 100;
        if (this.pipelineCacheManager.pipelineCache.size > MAX_CACHE_SIZE) {
            // Get all entries sorted by last used
            const entries = Array.from(this.pipelineCacheManager.pipelineCache.entries())
                .sort((a, b) => a[1].metadata.lastUsed - b[1].metadata.lastUsed);

            // Remove oldest entries until we're back to the limit
            while (this.pipelineCacheManager.pipelineCache.size > MAX_CACHE_SIZE) {
                const [key] = entries.shift();
                this.pipelineCacheManager.pipelineCache.delete(key);
            }

            if (this.device.label?.includes('debug')) {
                console.log('Cache maintenance performed', {
                    newSize: this.pipelineCacheManager.pipelineCache.size
                });
            }
        }
    }

    _generateLayoutKey(filter, pass) {
        const keyComponents = {
            type: filter.type,
            inputTextureCount: pass.inputTexture?.length || 0,
            hasBuffer: !!filter.bufferAttachment?.bindings,
            bufferType: filter.type === 'compute' ? 'storage' : 'uniform',
            bindingIndex: filter.bufferAttachment?.bindingIndex
        };
        return this.pipelineCacheManager._hashString(JSON.stringify(keyComponents));
    }

    /*createBindGroupLayout(filter, pass) {
        // Generate a unique key for the layout
        const layoutKey = this._generateLayoutKey(filter, pass);

        const entries = [];
        const visibility = filter.type === 'compute' ? GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT;

        // Add sampler binding with correct visibility
        entries.push({
            binding: 0,
            visibility,
            sampler: { type: 'filtering' }
        });

        // Add texture bindings with correct visibility
        if (pass.inputTexture && Array.isArray(pass.inputTexture)) {
            pass.inputTexture.forEach((_, index) => {
                entries.push({
                    binding: index + 1,
                    visibility,
                    texture: { sampleType: 'float' }
                });
            });
        }

        // Add buffer binding if needed with correct visibility
        if (filter.bufferAttachment?.bindings) {
            entries.push({
                binding: filter.bufferAttachment.bindingIndex || 3,
                visibility,
                buffer: {
                    type: filter.type === 'compute' ? 'storage' : 'uniform'
                }
            });
        }

        // Store the layout entries for reference
        pass.bindGroupLayoutEntries = entries;

        // Try to get from cache first
        let layout = this.pipelineCacheManager.layoutCache.get(layoutKey)?.layout;

        if (!layout) {
            layout = this.device.createBindGroupLayout({ entries });

            // Cache the new layout
            this.pipelineCacheManager.layoutCache.set(layoutKey, {
                layout,
                entries,
                metadata: {
                    createdAt: Date.now(),
                    type: filter.type,
                    lastUsed: Date.now()
                }
            });
            this.pipelineCacheManager.stats.layoutsCreated++;
        }
        else {
            this.pipelineCacheManager.stats.layoutsReused++;
            this.pipelineCacheManager.layoutCache.get(layoutKey).metadata.lastUsed = Date.now();
        }

        // Important: store entries on layout for bind group creation
        layout.entries = entries;

        return layout;
    }*/
    createBindGroupLayout(filter, pass) {
        const layoutKey = GPUUtils.generateBindGroupLayoutKey(filter, pass);

        // Try cache first
        let layout = this.pipelineCacheManager.layoutCache.get(layoutKey)?.layout;

        if (!layout) {
            const entries = GPUUtils.createStandardLayoutEntries({ filter, pass });
            layout = this.device.createBindGroupLayout({ entries });

            // Cache the new layout
            this.pipelineCacheManager.layoutCache.set(layoutKey, {
                layout,
                entries,
                metadata: {
                    createdAt: Date.now(),
                    type: filter.type,
                    lastUsed: Date.now()
                }
            });
        }

        layout.entries = GPUUtils.createStandardLayoutEntries({ filter, pass });
        return layout;
    }

    ////////////////
    /*_generateDetailedPipelineKey(config) {
        const keyComponents = {
            // Basic pipeline configuration
            type: config.type,
            shader: config.shaderURL,  // Use URL instead of content
            format: config.presentationFormat,
            sampleCount: config.sampleCount,

            // Detailed layout information
            layoutEntries: config.bindGroupLayout.map(entry => ({
                binding: entry.binding,
                visibility: entry.visibility,
                bufferType: entry.buffer?.type,
                textureFormat: entry.texture?.format,
                samplerType: entry.sampler?.type,
                viewDimension: entry.texture?.viewDimension
            })),

            // For render pipelines
            vertex: config.type !== 'compute' ? {
                buffers: [
                    {
                        arrayStride: 8,
                        stepMode: 'vertex',
                        attributes: [
                            { format: 'float32x2', offset: 0, shaderLocation: 0 }
                        ]
                    },
                    {
                        arrayStride: 8,
                        stepMode: 'vertex',
                        attributes: [
                            { format: 'float32x2', offset: 0, shaderLocation: 1 }
                        ]
                    }
                ],
                entryPoint: 'vs'
            } : undefined,

            fragment: config.type !== 'compute' ? {
                targets: [{ format: config.presentationFormat }],
                entryPoint: 'fs'
            } : undefined,

            // For compute pipelines
            compute: config.type === 'compute' ? {
                entryPoint: 'main'
            } : undefined,

            // Add multisample state for render pipelines
            multisample: config.type !== 'compute' ? {
                count: config.sampleCount,
                mask: 0xFFFFFFFF,
                alphaToCoverageEnabled: false
            } : undefined
        };

        // Generate a deterministic JSON string
        const sortedKey = JSON.stringify(keyComponents, Object.keys(keyComponents).sort());
        return this.pipelineCacheManager._hashString(sortedKey);
    }*/
    _generateDetailedPipelineKey(config) {
        return GPUUtils.generatePipelineKey(config);
    }

    /*createBindGroup(layout, filter, pass, bufferResource) {

        if (!layout) {
            throw new Error('No layout provided for bind group creation');
        }

        const entries = [];

        // Add sampler
        entries.push({
            binding: 0,
            resource: this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear'
            })
        });

        // Add texture resources - maintain original binding index calculation
        if (pass.inputTexture && Array.isArray(pass.inputTexture)) {
            pass.inputTexture.forEach((textureName, index) => {
                const textureView = this.textureManager.getTexture(textureName)?.createView();
                if (!textureView) {
                    throw new Error(`Texture ${textureName} not found`);
                }
                entries.push({
                    binding: index + 1,  // Keep original binding calculation
                    resource: textureView
                });
            });
        }

        // Add buffer resource if needed
        if (filter.bufferAttachment?.bindings && bufferResource?.buffer) {
            entries.push({
                binding: filter.bufferAttachment.bindingIndex || 3,
                resource: {
                    buffer: bufferResource.buffer,
                    offset: 0,
                    size: bufferResource.buffer.size
                }
            });
        }

        try {
            const bindGroup = this.device.createBindGroup({
                layout,
                entries
            });

            if (!bindGroup) {
                throw new Error('Failed to create bind group');
            }

            return bindGroup;
        } catch (error) {
            console.error('Error creating bind group:', error);
            throw error;
        }
    }*/
    createBindGroup(layout, filter, pass, bufferResource) {
        if (!layout) {
            throw new Error('No layout provided for bind group creation');
        }

        const entries = GPUUtils.createStandardBindGroupEntries({
            device: this.device,
            textureManager: this.textureManager,
            filter,
            pass,
            bufferResource
        });

        try {
            return this.device.createBindGroup({ layout, entries });
        } catch (error) {
            throw GPUUtils.handleError('PipelineManager', 'createBindGroup', error, {
                filterLabel: filter.label,
                passLabel: pass.label
            });
        }
    }

    async createFilterPipeline(filter) {
        try {
            let bufferResource;
            if (filter.bufferAttachment?.bindings) {
                bufferResource = await this.bufferManager.createFilterBuffers(filter);
            }

            let hasValidPasses = false; // Track if any passes are valid

            for (const pass of filter.passes) {
                const startTime = performance.now();

                try {
                    // Load and cache shader with enhanced error handling
                    const shaderCode = await this.loadShader(pass.shaderURL);
                    const shaderModule = await this.pipelineCacheManager.getShaderModule(
                        shaderCode,
                        {
                            label: `${filter.label}_${pass.label || 'pass'}`
                        }
                    );

                    // Create bind group layout and pipeline as before...
                    const bindGroupLayout = this.createBindGroupLayout(filter, pass);


                    // Create pipeline layout
                    const pipelineLayout = this.device.createPipelineLayout({
                        bindGroupLayouts: [bindGroupLayout]
                    });

                    // Generate pipeline key using URL
                    const pipelineKey = this._generateDetailedPipelineKey({
                        type: filter.type,
                        shaderURL: pass.shaderURL,  // Use URL instead of content
                        presentationFormat: this.presentationFormat,
                        sampleCount: filter.type === 'compute' ? 1 : 4,
                        bindGroupLayout: bindGroupLayout.entries
                    });

                    let pipeline = this.pipelineCacheManager.pipelineCache.get(pipelineKey);
                    let actualPipeline;

                    if (!pipeline) {
                        if (filter.type === 'compute') {
                            const computeDescriptor = {
                                layout: pipelineLayout,
                                compute: {
                                    module: shaderModule,
                                    entryPoint: 'main'
                                }
                            };
                            actualPipeline = this.device.createComputePipeline(computeDescriptor);
                        } else {
                            const renderDescriptor = {
                                layout: pipelineLayout,
                                vertex: {
                                    module: shaderModule,
                                    entryPoint: 'vs',
                                    buffers: [
                                        {
                                            arrayStride: 8,
                                            attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }]
                                        },
                                        {
                                            arrayStride: 8,
                                            attributes: [{ shaderLocation: 1, format: 'float32x2', offset: 0 }]
                                        }
                                    ]
                                },
                                fragment: {
                                    module: shaderModule,
                                    entryPoint: 'fs',
                                    targets: [{ format: this.presentationFormat }]
                                },
                                multisample: {
                                    count: 4
                                }
                            };
                            actualPipeline = this.device.createRenderPipeline(renderDescriptor);
                        }

                        this.pipelineCacheManager.pipelineCache.set(pipelineKey, {
                            pipeline: actualPipeline,
                            metadata: {
                                createdAt: Date.now(),
                                type: filter.type,
                                shaderURL: pass.shaderURL,
                                lastUsed: Date.now()
                            }
                        });

                        const endTime = performance.now();
                        this.pipelineCacheManager.stats.pipelinesCreated++;
                        this.pipelineCacheManager.stats.cacheMisses++;
                        this.pipelineCacheManager._updatePerformanceMetrics({
                            operationType: 'pipeline',
                            operation: 'create',
                            duration: endTime - startTime
                        });
                    } else {
                        actualPipeline = pipeline.pipeline;
                        pipeline.metadata.lastUsed = Date.now();
                        this.pipelineCacheManager.stats.pipelinesReused++;
                        this.pipelineCacheManager.stats.cacheHits++;
                        this.pipelineCacheManager._updatePerformanceMetrics({
                            operationType: 'pipeline',
                            operation: 'reuse'
                        });
                    }

                    // Assign pipeline first
                    pass.pipeline = actualPipeline;

                    // Create bind group and verify
                    pass.bindGroup = [this.createBindGroup(bindGroupLayout, filter, pass, bufferResource)];
                    if (!pass.bindGroup || !pass.bindGroup[0]) {
                        throw new Error(`Failed to create valid bind group for pass ${pass.label}`);
                    }

                    // Wait for GPU operations
                    await this.device.queue.onSubmittedWorkDone();

                    // Mark this pass as valid
                    hasValidPasses = true;

                } catch (error) {
                    // Check if this is a shader compilation error
                    const isShaderError = error.name === 'ShaderCompilationError';

                    // Log detailed error but don't throw
                    console.error(`Failed to create pipeline for pass '${pass.label}' in filter '${filter.label}':`,
                        isShaderError ? 'Shader compilation error' : error);

                    // Mark this pass as inactive so we skip it during rendering
                    pass.active = false;

                    // Use app.debugLogger if available
                    if (this.app && this.app.debugLogger) {
                        this.app.debugLogger.error('PipelineCreation',
                            `Shader compilation failed for ${filter.label}/${pass.label}, pass will be skipped.`,
                            error);
                    }

                    // Continue with other passes instead of failing
                    continue;
                }

            }

            // Only throw an error if all passes failed
            if (!hasValidPasses && filter.passes.length > 0) {
                throw new Error(`All passes failed for filter ${filter.label}`);
            }

            await this._performCacheMaintenance();

            return bufferResource;
        } catch (error) {
            // Check if it's a shader compilation error
            if (error.name === 'ShaderCompilationError') {
                // Format error for display
                ({
                    label: filter.label || 'Unknown Shader',
                    summary: error.message,
                    details: this._parseShaderErrorMessage(error.message),
                    errorCount: 1
                });
            }
            console.error(`Failed to create pipeline for filter ${filter.label}`, error);
            throw error;
        }
    }

    // Helper to parse shader error messages into structured format
    _parseShaderErrorMessage(message) {
        // Split message by lines
        const lines = message.split('\n');
        // Extract relevant parts and format for display
        return lines.map(line => {
            // Remove any ansi color codes and format nicely
            return line.replace(/\x1b\[\d+m/g, '');
        });
    }

    /**
     * Determines appropriate fallback shader type based on filter properties
     * This method is kept for documentation purposes, but fallbacks are not currently used.
     * @private
     */
    _determineFallbackType(filter, pass) {
        // Implementation remains for documentation purposes
        if (filter.type === 'compute') {
            return 'basic-compute';
        }

        const filterName = filter.label.toLowerCase();
        if (filterName.includes('gray') || filterName.includes('luma')) {
            return 'grayscale';
        }

        return 'basic-render';
    }
}

class BufferManager {
    constructor(device) {
        this.device = device;
    }

    applyOffsetPadding(size) {
        const PADDING_SIZE = 16;
        return Math.ceil(size / PADDING_SIZE) * PADDING_SIZE;
    }

    /**
     * Calculates the memory layout for buffer bindings with proper alignment.
     *
     * @param {Object} bindings - Buffer binding configurations
     * @returns {Object} Layout information including sections and total size
     * @property {Map} sections - Map of section layouts by type
     * @property {number} totalSize - Total buffer size in bytes
     */
    calculateBufferSize(binding) {
        if (binding.size) {
            // Use explicit size if provided
            return binding.size;
        }

        if (binding.value === undefined) {
            // Default size if no value provided
            return 4;
        }

        // Calculate size based on value
        if (Array.isArray(binding.value)) {
            return binding.value.length * 4; // 4 bytes per element
        }

        // Handle different types
        switch (binding.type) {
            case 'float':
            case 'uniform':
                return 4; // Single float or uniform
            case 'vec2':
                return 8; // Two floats
            case 'vec3':
                return 12; // Three floats
            case 'vec4':
                return 16; // Four floats
            case 'mat4':
                return 64; // 4x4 matrix
            default:
                return 4; // Default to single float size
        }
    }

    createComputeBuffer(filter, binding) {
        // Calculate buffer size based on binding value
        const size = this.calculateBufferSize(binding);
        const paddedSize = this.applyOffsetPadding(size);

        // Create the buffer
        const buffer = this.device.createBuffer({
            size: paddedSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            label: `${filter.label} Compute Buffer`
        });

        // Initialize buffer if initial value is provided
        if (binding.value !== undefined) {
            const initialData = Array.isArray(binding.value) ?
                new Uint32Array(binding.value) :
                new Uint32Array([binding.value]);
            this.device.queue.writeBuffer(buffer, 0, initialData);
        }

        return buffer;
    }

    /**
     * Creates and initializes buffers for a filter's requirements.
     *
     * @async
     * @param {Object} filter - Filter configuration object
     * @returns {Promise<Object>} Created buffer and update methods
     * @property {GPUBuffer} buffer - The created GPU buffer
     * @property {Object} layout - Buffer layout information
     * @property {Function} update - Buffer update function
     */
    async createFilterBuffers(filter) {
        const bindings = filter.bufferAttachment.bindings;
        const isCompute = filter.type === 'compute';

        if (isCompute) {
            const computeBuffers = {};
            let updateFuncs = {};

            // Process each binding for compute shader
            for (const [key, binding] of Object.entries(bindings)) {
                if (binding.usage === 'write' || binding.usage === 'read' || binding.usage === 'readwrite') {
                    computeBuffers[key] = this.createComputeBuffer(filter, binding);

                    // Create update function based on binding type
                    if (binding.usage !== 'write') { // Only create update for readable buffers
                        updateFuncs[key] = (newValue) => {
                            const data = Array.isArray(newValue) ?
                                new Uint32Array(newValue) :
                                new Uint32Array([newValue]);
                            this.device.queue.writeBuffer(computeBuffers[key], 0, data);
                        };
                    }
                }
            }

            // Return single buffer for backward compatibility
            return {
                buffer: computeBuffers.histogram || computeBuffers[Object.keys(computeBuffers)[0]], // Get first buffer if no histogram
                buffers: computeBuffers,
                update: (newBindings) => {
                    for (const [key, value] of Object.entries(newBindings)) {
                        if (updateFuncs[key]) {
                            updateFuncs[key](value);
                        }
                    }
                }
            };
        }

        // Regular buffer creation for non-compute shaders
        let uniformsArray = [];
        let uniformsSize = 0;
        let floatsArray = [];
        let floatsSize = 0;

        // Process uniform bindings
        for (const param in bindings) {
            if (bindings[param].type === 'uniform') {
                bindings[param].bufferOffset = uniformsSize;
                uniformsSize += 4;
                uniformsArray.push(bindings[param].value);
            }
        }

        // Apply padding after uniforms
        uniformsSize = this.applyOffsetPadding(uniformsSize);
        floatsSize = uniformsSize;

        // Process float bindings
        for (const param in bindings) {
            if (bindings[param].type === 'float') {
                bindings[param].bufferOffset = floatsSize;
                if (Array.isArray(bindings[param].value)) {
                    floatsSize += (bindings[param].value.length * 4);
                    floatsArray = [...floatsArray, ...bindings[param].value];
                } else {
                    floatsSize += 4;
                    floatsArray.push(bindings[param].value);
                }
            }
        }

        // Apply final padding
        floatsSize = this.applyOffsetPadding(floatsSize);

        // Create the buffer
        const buffer = this.device.createBuffer({
            size: Math.max(floatsSize, 16),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: `${filter.label} Buffer`
        });

        // Write initial data
        if (uniformsArray.length > 0) {
            this.writeBuffer(buffer, 0, uniformsArray, 'uniform');
        }
        if (floatsArray.length > 0) {
            this.writeBuffer(buffer, uniformsSize, floatsArray, 'float');
        }

        return {
            buffer,
            update: (newBindings) => this.updateBufferData(buffer, newBindings, bindings)
        };
    }

    writeBuffer(buffer, offset, data, type) {
        const arrayType = type === 'uniform' ? Uint32Array : Float32Array;
        const arrayData = Array.isArray(data) ? data : [data];
        this.device.queue.writeBuffer(buffer, offset, new arrayType(arrayData));
    }

    updateBufferData(buffer, newBindings, originalBindings) {
        try {
            for (const [key, value] of Object.entries(newBindings)) {
                if (originalBindings[key]) {
                    const binding = originalBindings[key];
                    this.writeBuffer(
                        buffer,
                        binding.bufferOffset,
                        value.value,
                        binding.type
                    );
                } else {
                    throw new Error(
                        'BufferError',
                        `Binding "${key}" not found in original bindings`
                    );
                }
            }
        } catch (error) {
            console.error(
                'BufferError',
                'Failed to update buffer data',
                error
            );
            throw error;
        }
    }
}

class SimpleTexturePool {
    constructor(device) {
        this.device = device;
        this.availableTextures = new Map(); // descriptor hash -> texture[]
        
        // Add comprehensive memory tracking properties
        this.totalMemoryUsage = 0;      // Total memory usage in bytes
        this.activeMemoryUsage = 0;     // Memory used by active textures
        this.pooledMemoryUsage = 0;     // Memory used by pooled textures
        this.textureCount = {
            active: 0,                  // Number of active textures
            pooled: 0,                  // Number of pooled textures
            created: 0,                 // Total textures created
            reused: 0                   // Total textures reused
        };
    }

    /**
     * Get a texture descriptor hash for pooling
     */
    getDescriptorHash(descriptor) {
        const key = `${descriptor.format}_${descriptor.size.width}x${descriptor.size.height}` +
            `_${descriptor.usage}_${descriptor.sampleCount || 1}`;
        return key;
    }

    /**
     * Calculate memory usage for a texture based on its descriptor
     */
    calculateTextureMemoryUsage(descriptor) {
        const bytesPerPixel = this.getFormatSize(descriptor.format);
        const width = descriptor.size.width;
        const height = descriptor.size.height;
        return width * height * bytesPerPixel;
    }

    /**
     * Get a texture from the pool or create a new one
     */
    acquire(descriptor) {
        const key = this.getDescriptorHash(descriptor);
        const available = this.availableTextures.get(key) || [];
        const memoryUsage = this.calculateTextureMemoryUsage(descriptor);

        if (available.length > 0) {
            // Reuse an existing texture from the pool
            const texture = available.pop();
            
            // Update memory tracking
            this.pooledMemoryUsage -= memoryUsage;
            this.activeMemoryUsage += memoryUsage;
            this.textureCount.pooled--;
            this.textureCount.active++;
            this.textureCount.reused++;
            
            return texture;
        }

        // Create new texture if none available
        const texture = this.device.createTexture(descriptor);
        
        // Store descriptor and memory usage on texture for tracking
        texture.descriptor = {...descriptor}; // Clone to avoid reference issues
        texture._memoryUsage = memoryUsage;
        
        // Update memory tracking
        this.totalMemoryUsage += memoryUsage;
        this.activeMemoryUsage += memoryUsage;
        this.textureCount.active++;
        this.textureCount.created++;
        
        return texture;
    }

    /**
     * Return a texture to the pool for reuse
     */
    release(texture) {
        if (!texture || !texture.descriptor) {
            return;
        }

        const key = this.getDescriptorHash(texture.descriptor);
        const available = this.availableTextures.get(key) || [];
        const memoryUsage = texture._memoryUsage || 0;
        
        // Update memory tracking
        this.activeMemoryUsage -= memoryUsage;
        this.pooledMemoryUsage += memoryUsage;
        this.textureCount.active--;
        this.textureCount.pooled++;
        
        available.push(texture);
        this.availableTextures.set(key, available);
    }

    /**
     * Get bytes per pixel for a format
     */
    getFormatSize(format) {
        switch(format) {
            case 'r8unorm': 
            case 'r8snorm': 
            case 'r8uint':
            case 'r8sint':
                return 1;
            case 'r16uint':
            case 'r16sint':
            case 'r16float':
            case 'rg8unorm':
            case 'rg8snorm':
                return 2;
            case 'r32float':
            case 'r32uint':
            case 'r32sint':
            case 'rg16float':
            case 'rgba8unorm':
            case 'rgba8unorm-srgb':
            case 'rgba8snorm':
            case 'bgra8unorm':
            case 'bgra8unorm-srgb':
                return 4;
            case 'rg32float':
            case 'rgba16float':
                return 8;
            case 'rgba32float':
                return 16;
            default:
                return 4; // Default to 4 bytes for unknown formats
        }
    }

    /**
     * Get current memory statistics
     */
    getMemoryStats() {
        return {
            totalBytes: this.totalMemoryUsage,
            activeBytes: this.activeMemoryUsage,
            pooledBytes: this.pooledMemoryUsage,
            megabytes: {
                total: (this.totalMemoryUsage / (1024 * 1024)).toFixed(2),
                active: (this.activeMemoryUsage / (1024 * 1024)).toFixed(2),
                pooled: (this.pooledMemoryUsage / (1024 * 1024)).toFixed(2)
            },
            textureCount: {
                active: this.textureCount.active,
                pooled: this.textureCount.pooled,
                total: this.textureCount.active + this.textureCount.pooled,
                created: this.textureCount.created,
                reused: this.textureCount.reused,
                reuseRate: this.textureCount.created > 0 ? 
                    (this.textureCount.reused / (this.textureCount.created + this.textureCount.reused)).toFixed(2) : "0.00"
            },
            formats: this.getFormatDistribution()
        };
    }
    
    /**
     * Get distribution of texture formats in the pool
     */
    getFormatDistribution() {
        const formats = {};
        for (const [key, textures] of this.availableTextures.entries()) {
            const format = key.split('_')[0];
            formats[format] = (formats[format] || 0) + textures.length;
        }
        return formats;
    }

    /**
     * Destroy all pooled textures
     */
    destroy() {
        for (const textures of this.availableTextures.values()) {
            for (const texture of textures) {
                // Update memory tracking before destroying
                this.totalMemoryUsage -= (texture._memoryUsage || 0);
                this.pooledMemoryUsage -= (texture._memoryUsage || 0);
                texture.destroy();
            }
        }
        
        // Reset tracking
        this.availableTextures.clear();
        this.textureCount.pooled = 0;
    }
}

class TextureManager {
    constructor(app) {
        this.device = app.device;
        this.presentationFormat = app.presentationFormat;
        this.texturePool = new SimpleTexturePool(this.device);
        this.activeTextures = new Map(); // Currently in-use textures
    }

    async copyVideoFrameToTexture(video, textureKey) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        return new Promise((resolve) => {
            video.requestVideoFrameCallback(() => {
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);
                this.copyImageToTexture(canvas, textureKey, {
                    width: video.videoWidth,
                    height: video.videoHeight
                });
                resolve();
            });
        });
    }
    /////////////////////// END VIDEO CODE ///////////////////////

    createTexture(key, descriptor) {
        // Release existing texture if any
        if (this.activeTextures.has(key)) {
            this.releaseTexture(key);
        }

        // Get texture from pool or create new one
        const texture = this.texturePool.acquire(descriptor);
        this.activeTextures.set(key, texture);
        return texture;
    }

    createTextures(settings) {
        try {
            for (const [key, textureSettings] of Object.entries(settings.textures)) {
                const descriptor = {
                    label: textureSettings.label || key,
                    size: textureSettings.size || {
                        width: settings.canvas.width,
                        height: settings.canvas.height,
                        depthOrArrayLayers: 1
                    },
                    format: textureSettings.format || this.presentationFormat,
                    usage: textureSettings.usage || (
                        GPUTextureUsage.TEXTURE_BINDING |
                        GPUTextureUsage.RENDER_ATTACHMENT |
                        GPUTextureUsage.COPY_SRC |
                        GPUTextureUsage.COPY_DST
                    ),
                    sampleCount: textureSettings.sampleCount || 1,
                };

                this.createTexture(key, descriptor);
            }
        } catch (error) {
            console.error('Error creating textures:', error);
            throw error;
        }
    }

    copyTextureToTexture(commandEncoder, source, destination, dimensions) {
        const sourceTexture = this.activeTextures.get(source);
        const destTexture = this.activeTextures.get(destination);

        if (!sourceTexture || !destTexture) {
            throw new Error('Source or destination texture not found');
        }

        if (commandEncoder) {
            commandEncoder.copyTextureToTexture(
                { texture: sourceTexture },
                { texture: destTexture },
                dimensions
            );
        } else {
            const encoder = this.device.createCommandEncoder();
            encoder.copyTextureToTexture(
                { texture: sourceTexture },
                { texture: destTexture },
                dimensions
            );
            this.device.queue.submit([encoder.finish()]);
        }
    }

    releaseTexture(key) {
        const texture = this.activeTextures.get(key);
        if (texture) {
            this.texturePool.release(texture);
            this.activeTextures.delete(key);
        }
    }

    getTexture(key) {
        try {

            const texture = this.activeTextures.get(key);
            return texture;

        } catch (error) {
            console.error(`Error getting texture "${key}" not found. Available textures keys include: ${texture}, ${Array.from(this.activeTextures.keys()).join(', ')}:`, error);
            throw error;
        }
    }

    async copyImageToTexture(image, textureKey, dimensions) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = dimensions.width;
            canvas.height = dimensions.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const imageBitmap = await createImageBitmap(canvas);

            const texture = this.getTexture(textureKey);
            this.device.queue.copyExternalImageToTexture(
                { source: imageBitmap, flipY: false },
                { texture },
                dimensions
            );
        } catch (error) {
            console.error(`Failed to copy image to texture ${textureKey}`, error);
            throw error;
        }
    }

    async destroyTextures() {
        // Release all active textures back to pool
        for (const [key] of this.activeTextures) {
            this.releaseTexture(key);
        }

        // Destroy the pool itself
        this.texturePool.destroy();
    }

}

class BindingManager {
    constructor(app) {
        this.device = app.device;
        this.textureManager = app.textureManager;
        this.filters = app.filters;
        this.bindGroupLayoutArray = [];
        this.bindGroupArray = [];

        // Reference the PipelineManager instead of directly accessing cacheManager
        this.pipelineManager = app.pipelineManager;
    }

    createBindings(resource = null) {
        const groupIndex = 0;
        this.bindGroupLayoutArray[groupIndex] = [];
        this.bindGroupArray[groupIndex] = [];

        // Add sampler binding
        this.bindGroupLayoutArray[groupIndex] = [{
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: 'filtering' }
        }];

        this.bindGroupArray[groupIndex] = [{
            binding: 0,
            /*resource: this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear'
            })*/
            resource: GPUUtils.createStandardSampler(this.device)
        }];

        // Add texture bindings based on max input texture length
        const maxTextures = this.findMaxInputTextureLength();
        for (let i = 0; i < maxTextures; i++) {
            const bindingIndex = i + 1;

            // Add to layout array
            this.bindGroupLayoutArray[groupIndex].push({
                binding: bindingIndex,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float' }
            });

            // Add to bind group array
            if (resource) {
                this.bindGroupArray[groupIndex].push({
                    binding: bindingIndex,
                    resource: resource
                });
            }
        }
    }

    createBindGroupLayout(groupIndex) {
        return this.device.createBindGroupLayout({
            entries: this.bindGroupLayoutArray[groupIndex]
        });
    }

    /*createDynamicBindGroupEntries(filter, pass) {
        const visibility = filter.type === 'compute' ?
            GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT;

        const entries = [{
            binding: 0,
            visibility,
            sampler: { type: 'filtering' }
        }];

        // Add texture bindings
        if (pass.inputTexture?.length) {
            pass.inputTexture.forEach((_, index) => {
                entries.push({
                    binding: index + 1,
                    visibility,
                    texture: { sampleType: 'float' }
                });
            });
        }

        // Add buffer binding if needed
        if (filter.bufferAttachment?.bindings) {
            entries.push({
                binding: filter.bufferAttachment.bindingIndex || 3,
                visibility,
                buffer: {
                    type: filter.type === 'compute' ? 'storage' : 'uniform'
                }
            });
        }

        return entries;
    }*/
    createDynamicBindGroupEntries(filter, pass) {
        return GPUUtils.createStandardLayoutEntries({ filter, pass });
    }

    /*createDynamicBindGroup(layout, filter, pass, bufferResource) {
        try {
            const entries = [{
                binding: 0,
                resource: this.device.createSampler({
                    magFilter: 'linear',
                    minFilter: 'linear'
                })
            }];

            if (pass.inputTexture?.length) {
                for (let i = 0; i < pass.inputTexture.length; i++) {
                    const textureName = pass.inputTexture[i];
                    const textureView = this.textureManager.getTexture(textureName)?.createView();
                    if (!textureView) {
                        this.throwError(
                            'TextureError',
                            `Texture "${textureName}" not found. Available textures: ${Array.isArray(pass.inputTexture) ? pass.inputTexture.join(', ') : 'none'}`
                        );
                    }
                    entries.push({
                        binding: i + 1,
                        resource: textureView
                    });
                }
            }

            if (filter.bufferAttachment?.bindings && bufferResource?.buffer) {
                entries.push({
                    binding: filter.bufferAttachment.bindingIndex || 3,
                    resource: {
                        buffer: bufferResource.buffer,
                        offset: 0,
                        size: bufferResource.buffer.size
                    }
                });
            }

            return this.device.createBindGroup({ layout, entries });
        } catch (error) {
            console.error(
                'BindGroupError',
                `Failed to create bind group for filter ${filter.label}`,
                error
            );
            throw error;
        }
    }*/
    createDynamicBindGroup(layout, filter, pass, bufferResource) {
        try {
            const entries = GPUUtils.createStandardBindGroupEntries({
                device: this.device,
                textureManager: this.textureManager,
                filter,
                pass,
                bufferResource
            });

            return this.device.createBindGroup({ layout, entries });
        } catch (error) {
            throw GPUUtils.handleError('BindingManager', 'createDynamicBindGroup', error, {
                filterLabel: filter.label,
                passLabel: pass.label
            });
        }
    }

    findMaxInputTextureLength() {
        let maxLength = 0;
        Object.values(this.filters).forEach(filter => {
            filter.passes.forEach(pass => {
                if (Array.isArray(pass.inputTexture)) {
                    maxLength = Math.max(maxLength, pass.inputTexture.length);
                }
            });
        });
        return maxLength;
    }

    getBindGroupArray() {
        return this.bindGroupArray;
    }

    /*_generateLayoutKey(filter, pass) {
        // Ensure we have access to a hash function even if pipelineManager isn't available
        const hashString = (str) => {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return hash.toString(36);
        };

        const keyComponents = {
            type: filter.type,
            inputTextureCount: pass.inputTexture?.length || 0,
            hasBuffer: !!filter.bufferAttachment?.bindings,
            bufferType: filter.type === 'compute' ? 'storage' : 'uniform',
            bindingIndex: filter.bufferAttachment?.bindingIndex
        };

        // Use pipelineManager's hash function if available, otherwise use local implementation
        const hashFunction = this.pipelineManager?.pipelineCacheManager?._hashString || hashString;
        return hashFunction(JSON.stringify(keyComponents));
    }*/
    _generateLayoutKey(filter, pass) {
        return GPUUtils.generateBindGroupLayoutKey(filter, pass);
    }

    async updateFilterInputTexture(filterKey, passIndex, bindingIndex, textureKey, textureIndex, filters) {
        const filter = filters[filterKey];

        if (!filter) {
            throw new Error(
                'FilterError',
                `Filter "${filterKey}" not found`
            );
        }

        const pass = filter.passes[passIndex];

        if (!pass) {
            if (passIndex === null) {
                throw new Error(
                    'FilterError',
                    `passIndex "${passIndex}" not found`
                );
            }

            throw new Error(
                'FilterError',
                `Pass ${passIndex} not found in filter "${filterKey}"`
            );
        }

        // Update input texture array
        if (Array.isArray(textureKey)) {
            pass.inputTexture = textureKey;
        } else {
            pass.inputTexture[textureIndex] = textureKey;
        }

        const groupIndex = filter.bufferAttachment.groupIndex;

        // Generate cache key for layout
        const layoutKey = this._generateLayoutKey(filter, pass);
        let bindGroupLayout;

        // Try to get cached layout if pipeline manager is available
        let cachedLayout = this.pipelineManager?.pipelineCacheManager?.layoutCache.get(layoutKey);

        if (cachedLayout?.layout && !cachedLayout.layout.destroyed) {
            bindGroupLayout = cachedLayout.layout;
            if (this.pipelineManager?.pipelineCacheManager) {
                this.pipelineManager.pipelineCacheManager.stats.layoutsReused++;
            }
        } else {
            // Create new layout if not in cache or invalid
            const layoutEntries = this.createDynamicBindGroupEntries(filter, pass);
            bindGroupLayout = this.device.createBindGroupLayout({
                entries: layoutEntries
            });

            // Cache the new layout if pipeline manager is available
            if (this.pipelineManager?.pipelineCacheManager) {
                this.pipelineManager.pipelineCacheManager.layoutCache.set(layoutKey, {
                    layout: bindGroupLayout,
                    entries: layoutEntries,
                    metadata: {
                        createdAt: Date.now(),
                        type: filter.type,
                        lastUsed: Date.now()
                    }
                });
                this.pipelineManager.pipelineCacheManager.stats.layoutsCreated++;
            }
        }

        // Create new bind group
        const bindGroup = this.createDynamicBindGroup(
            bindGroupLayout,
            filter,
            pass,
            filter.resources
        );

        // Update the bindings
        this.bindGroupLayoutArray[groupIndex] = bindGroupLayout.entries;
        pass.bindGroup[groupIndex] = bindGroup;

        // Update cache metadata if available
        if (cachedLayout && this.pipelineManager?.pipelineCacheManager) {
            cachedLayout.metadata.lastUsed = Date.now();
        }
    }

    /**
 * Set up bindings for a specific filter
 * @param {string} filterKey - The key of the filter
 * @param {object} filter - The filter object
 */
    setupFilterBindings(filterKey, filter) {
        if (!filter || !filter.passes) return;

        // Process each pass in the filter
        for (const pass of filter.passes) {
            if (!pass.active) continue;

            // Skip passes that already have bind groups
            if (pass.bindGroup && pass.bindGroup[0]) continue;

            // Make sure we have pipeline and entries
            if (!pass.pipeline) {
                console.error(`No pipeline available for pass: ${pass.label}`);
                continue;
            }

            if (!pass.bindGroupEntries) {
                console.warn(`No bind group entries for pass: ${pass.label}, creating empty entries`);
                pass.bindGroupEntries = [];
            }

            // Create bind group from pipeline layout
            try {
                pass.bindGroup = [this.app.device.createBindGroup({
                    layout: pass.pipeline.getBindGroupLayout(0),
                    entries: pass.bindGroupEntries
                })];
            } catch (error) {
                console.error(`Failed to create bind group for pass: ${pass.label}:`, error);
            }
        }
    }

}

class RenderQueue {
    constructor() {
        this.pendingOperations = new Map();
        this.isProcessing = false;
        this.currentOperation = null;
        this.stats = {
            completed: 0,
            failed: 0,
            queued: 0
        };

        this.processTimeout = null;
        this.debounceDelay = 16; // ~60fps
        this.autoProcess = true; // Allow disabling auto-processing

        this.performanceStats = {
            averageExecutionTime: 0,
            totalOperations: 0,
            maxExecutionTime: 0,
            minExecutionTime: Infinity
        };
    }

    queue(operation, priority = 'normal', metadata = {}, timeout = 30000) {
        const id = this.generateId();

        const operationWrapper = {
            id,
            operation,
            priority,
            metadata,
            timestamp: Date.now(),
            promise: null,
            resolve: null,
            reject: null,
            settled: false,
            timeout: timeout
        };

        // Add timeout handling in the promise
        const timeoutId = setTimeout(() => {
            if (!operationWrapper.settled) {
                operationWrapper.reject(new Error(`Operation ${id} timed out`));
            }
        }, timeout);

        operationWrapper.promise = new Promise((resolve, reject) => {
            operationWrapper.resolve = (value) => {
                if (!operationWrapper.settled) {
                    clearTimeout(timeoutId);
                    operationWrapper.settled = true;
                    resolve(value);
                }
            };
            operationWrapper.reject = (error) => {
                if (!operationWrapper.settled) {
                    operationWrapper.settled = true;
                    reject(error);
                }
            };
        });

        this.pendingOperations.set(id, operationWrapper);
        this.stats.queued++;

        if (this.autoProcess) {
            this.scheduleProcess();
        }

        return operationWrapper.promise;
    }

    scheduleProcess() {
        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
        }

        this.processTimeout = setTimeout(() => {
            this.processTimeout = null;
            if (!this.isProcessing && this.pendingOperations.size > 0) {
                this.process().catch(error => {
                    console.error('Auto-process error:', error);
                });
            }
        }, this.debounceDelay || 16);
    }

    // Add error recovery method
    handleProcessError(error) {
        console.error('Critical render queue error:', error);

        // Count pending operations before clearing
        const pendingCount = this.pendingOperations.size;

        // Reject all pending operations
        for (const [id, operation] of this.pendingOperations.entries()) {
            if (operation.reject) {
                operation.reject(new Error('Queue processing failed: ' + error.message));
            }
        }

        // Clear the queue
        this.pendingOperations.clear();
        this.stats.queued = 0;
        this.stats.failed += pendingCount; // Use saved count, not .size after clearing

        // Reset processing state
        this.isProcessing = false;
    }

    async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            let processedCount = 0;

            while (this.pendingOperations.size > 0) {
                const operations = Array.from(this.pendingOperations.entries())
                    .sort(([idA, opA], [idB, opB]) => {
                        const priorityDiff = this.getPriorityValue(opB.priority) - this.getPriorityValue(opA.priority);
                        return priorityDiff === 0 ? opA.timestamp - opB.timestamp : priorityDiff;
                    });

                if (operations.length === 0) break;

                const [id, { operation, metadata, resolve, reject }] = operations[0];
                this.pendingOperations.delete(id);
                this.stats.queued--;
                this.currentOperation = { id, metadata };

                try {
                    const startTime = performance.now();
                    const result = await operation();
                    const executionTime = performance.now() - startTime;

                    // Update performance stats
                    this.updatePerformanceStats(executionTime);

                    this.stats.completed++;

                    if (resolve) resolve(result);
                } catch (error) {
                    console.error('Render operation failed:', error);
                    this.stats.failed++;
                    if (reject) reject(error);
                }

                this.currentOperation = null;
                processedCount++;
            }
        } catch (criticalError) {
            this.handleProcessError(criticalError);
            throw criticalError;
        } finally {
            this.isProcessing = false;
        }
    }

    // Reset stats
    resetStats() {
        this.stats = {
            completed: 0,
            failed: 0,
            queued: this.pendingOperations.size
        };
        this.performanceStats = {
            averageExecutionTime: 0,
            totalOperations: 0,
            maxExecutionTime: 0,
            minExecutionTime: Infinity
        };
    }

    // Add method to get current status
    getStatus() {
        return {
            isProcessing: this.isProcessing,
            pendingCount: this.pendingOperations.size,
            currentOperation: this.currentOperation,
            stats: { ...this.stats }
        };
    }

    getPriorityValue(priority) {
        const priorities = {
            'urgent': 4,
            'high': 3,
            'normal': 2,
            'low': 1,
            'background': 0
        };
        return priorities[priority] || 2;
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    cancel(id) {
        return this.pendingOperations.delete(id);
    }

    // Update clear method to be safer
    clear(force = false) {
        if (!force && this.isProcessing) {
            // If processing and not forced, use graceful stop
            this.stopAfterCurrent();
            return;
        }

        // Force clear - reject everything
        for (const [id, operation] of this.pendingOperations.entries()) {
            if (operation.reject) {
                operation.reject(new Error('Queue cleared'));
            }
        }

        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
            this.processTimeout = null;
        }

        this.pendingOperations.clear();
        this.stats.queued = 0;
        this.currentOperation = null;
    }

    // Other Methods

    // These help you identify performance bottlenecks
    // Get performance stats
    getPerformanceStats() {
        return { ...this.performanceStats };
    }

    // Update performance stats after each operation
    updatePerformanceStats(executionTime) {
        this.performanceStats.totalOperations++;
        this.performanceStats.maxExecutionTime = Math.max(this.performanceStats.maxExecutionTime, executionTime);
        this.performanceStats.minExecutionTime = Math.min(this.performanceStats.minExecutionTime, executionTime);

        // Calculate rolling average
        const alpha = 0.1; // Weight for new values
        this.performanceStats.averageExecutionTime =
            (this.performanceStats.averageExecutionTime * (1 - alpha)) +
            (executionTime * alpha);
    }


    // Useful for testing different frame rates
    // Set custom debounce delay
    setDebounceDelay(delay) {
        this.debounceDelay = Math.max(0, delay);
    }


    // Helpful for debugging queue behavior
    async processNow() {
        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
            this.processTimeout = null;
        }
        return this.process();
    }

    // Disable/enable auto-processing
    setAutoProcess(enabled) {
        this.autoProcess = enabled;
        if (!enabled && this.processTimeout) {
            clearTimeout(this.processTimeout);
            this.processTimeout = null;
        }
    }


    // Useful when you need to cancel specific operation types
    cancelByMetadata(key, value) {
        let cancelled = 0;
        for (const [id, op] of this.pendingOperations.entries()) {
            if (op.metadata[key] === value) {
                // Check if reject exists before calling
                if (op.reject && typeof op.reject === 'function') {
                    op.reject(new Error('Operation cancelled'));
                }
                this.pendingOperations.delete(id);
                cancelled++;
                this.stats.queued = Math.max(0, this.stats.queued - 1); // Update stats
            }
        }
        return cancelled;
    }

    
    // Good for graceful shutdown
    // Add this new method to gracefully stop after current operation
    stopAfterCurrent() {
        const currentId = this.currentOperation?.id;

        for (const [id, operation] of this.pendingOperations.entries()) {
            if (id !== currentId && operation.reject && typeof operation.reject === 'function' && !operation.settled) {
                try {
                    operation.settled = true; // Mark as settled before rejecting
                    operation.reject(new Error('Queue stopped'));
                } catch (error) {
                    console.warn(`Failed to reject operation ${id}:`, error);
                }
            }
        }

        // Remove all except current operation
        if (currentId && this.pendingOperations.has(currentId)) {
            const currentOp = this.pendingOperations.get(currentId);
            this.pendingOperations.clear();
            this.pendingOperations.set(currentId, currentOp);
            this.stats.queued = 1;
        } else {
            this.pendingOperations.clear();
            this.stats.queued = 0;
        }

        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
            this.processTimeout = null;
        }
    }
}

class FilterManager {
    constructor(app) {
        this.app = app;

        // Initialize the render queue
        this.renderQueue = new RenderQueue();

        this.animationFrameId = null;
        this.renderCompleteCallbacks = new Map();
        this.renderCompleteCounter = 0;  // For unique IDs in waitForRenderComplete

        // Add frame timing control
        this.lastFrameTime = 0;
        this.frameInterval = 1000 / 60; // 60 FPS target

        this.histogramNeedsUpdate = false;
        this.autoThresholdEnabled = false;

        // Reference useful properties from the core renderer
        this.debug = app.debug || false;
        this.debugLogger = app.debugLogger;

        // For convenience, create direct references to frequently used objects
        this.filters = app.filters;
        this.canvas = app.canvas;

    }

    /**
    * Execute the filter for the given pass
    * @param {object} pass - The pass object to execute.
    * @param {string} type - The type of pass to execute.
    * @returns {Promise<boolean>}
    */
    async executeFilterPass(pass, type) {

        // Guard against undefined pass or label
        if (!pass) {
            console.error('Pass is undefined in executeFilterPass');
            return false;
        }

        // Add early validation
        if (!pass?.pipeline) {
            console.error(`Pass pipeline is missing: ${pass?.label || 'unnamed'}`);
            return false;
        }

        const passLabel = pass.label || 'unnamed pass';

        // Validate pass bindings
        if (!pass.bindGroup || !pass.bindGroup[0]) {
            console.error(`Pass bindGroup is missing: ${passLabel}`);
            return false;
        }

        const bindGroupArray = this.app.bindingManager.getBindGroupArray();
        if (!bindGroupArray[0]) {
            console.error('BindGroupArray[0] is missing');
            return false;
        }

        if (this.debug) {
            this.debugLogger.log('FilterExecution', `Executing ${type} pass:`, {
                label: pass.label,
                inputTextures: pass.inputTexture,
                outputTexture: pass.outputTexture
            });
        }

        // Debug texture state before execution
        if (pass.label.includes('debug')) {  // Add debug flag to passes you want to track
            console.log(`Executing ${pass.label}`);
            console.log('Input textures:', pass.inputTexture);
            console.log('Output texture:', pass.outputTexture);
            this.app.textureManager.debugTextures();
        }

        if (!pass.bindGroup || !bindGroupArray[0]) {
            console.error('No bind group available for pass:', pass.label);
            return false;
        }

        const { outputTexture, pipeline } = pass;

        if (type === 'compute') {
            // Get histogram filter and validate
            const histogramFilter = this.filters.histogramCompute;

            if (!histogramFilter?.resources?.buffer) {
                throw new Error('Histogram buffer not initialized');
            }

            const sourceBuffer = histogramFilter.resources.buffers?.histogram ||
                histogramFilter.resources.buffer;

            // Clear the combinedBuffer before rewriting to is using it
            await this.clearBuffer(sourceBuffer);

            this.app.commandQueue.addComputePass({
                label: `Compute pass for ${pass.label}`,
                descriptor: {
                    label: `Compute pass for ${pass.label}`
                },
                commands: (computePass) => {
                    computePass.setPipeline(pipeline);
                    computePass.setBindGroup(0, pass.bindGroup[0]);

                    const workgroupSizeX = 16;
                    const workgroupSizeY = 16;
                    const dispatchX = Math.ceil(this.canvas.width / workgroupSizeX);
                    const dispatchY = Math.ceil(this.canvas.height / workgroupSizeY);

                    computePass.dispatchWorkgroups(dispatchX, dispatchY);
                }
            });
        }
        else {
            // Check if context is valid before proceeding
            if (!this.app.context) {
                console.error('WebGPU context is undefined');

                if (!this.app.context) {
                    return false; // Still no context, can't proceed
                }
            }

            // If we're writing to the same texture we're reading from, use a temporary texture
            const shouldUseTemp = pass.inputTexture.includes(outputTexture);
            const finalOutputTexture = shouldUseTemp ? 'textureTemp' : outputTexture;

            // Debug texture selection
            if (pass.label.includes('debug')) {
                console.log('Should use temp:', shouldUseTemp);
                console.log('Final output texture:', finalOutputTexture);
            }

            // Safely access getCurrentTexture with null check
            let resolveTargetView;
            try {
                resolveTargetView = finalOutputTexture ?
                    this.app.textureManager.getTexture(finalOutputTexture).createView() :
                    this.app.context.getCurrentTexture().createView();
            } catch (err) {
                console.error('Error getting texture view:', err);
                return false;
            }

            // Make sure to flush commands after each pass if needed
            if (type === 'render' && outputTexture === undefined) {
                await this.app.commandQueue.flush();
                return true;
            }

            this.app.commandQueue.addRenderPass({
                label: `Render pass for ${pass.label}`,
                descriptor: {
                    colorAttachments: [{
                        view: this.app.textureManager.getTexture('textureMASS').createView(),
                        resolveTarget: resolveTargetView,
                        loadOp: 'clear',
                        storeOp: 'store',
                        clearValue: [0, 0, 0, 0]
                    }]
                },
                commands: (renderPass) => {
                    renderPass.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
                    renderPass.setPipeline(pipeline);
                    renderPass.setBindGroup(0, pass.bindGroup[0]);
                    renderPass.setVertexBuffer(0, this.app.positionBuffer);
                    renderPass.setVertexBuffer(1, this.app.texCordBuffer);
                    renderPass.draw(3);
                }
            });

            // If we used a temporary texture, copy it to the final destination
            if (shouldUseTemp && outputTexture) {
                this.app.commandQueue.addTextureCopy({
                    label: `Copy temp to ${outputTexture}`,
                    source: { texture: this.app.textureManager.getTexture('textureTemp') },
                    destination: { texture: this.app.textureManager.getTexture(outputTexture) },
                    copySize: {
                        width: this.canvas.width,
                        height: this.canvas.height,
                        depthOrArrayLayers: 1
                    }
                });
            }

            // Flush commands if this is the final pass
            if (outputTexture === undefined) {
                await this.app.commandQueue.flush();
                return true;
            }

            return false;
        }
    }

    async renderFilterPasses(filter) {
        let breakLoop = false;

        // Skip processing if filter doesn't have valid passes
        if (!filter || !filter.passes || !Array.isArray(filter.passes)) {
            console.warn('Invalid filter or filter passes in renderFilterPasses');
            return false;
        }

        // loop through the passes
        for (const pass of filter.passes) {
            if (pass && pass.active && pass.bindGroup && pass.bindGroup[0]) {
                breakLoop = await this.executeFilterPass(pass, filter.type);
            }
            else if (pass && pass.active) {
                console.warn(`Skipping active pass with missing bind group: ${pass.label || 'unnamed'}`);
            }

            if (breakLoop) {
                break;
            }
        }
        return breakLoop;
    }

    // Add a method for high-priority operations
    async urgentRender(drawToCanvas, transformations, filterUpdateConditions) {
        return this.renderQueue.queue(async () => {
            await this.renderFrame(drawToCanvas, transformations, filterUpdateConditions);
        }, 'high', {
            type: 'render',
            operation: 'urgentRender',
            conditions: filterUpdateConditions,
            urgent: true
        });
    }

    // Add a method for background operations
    async backgroundUpdate(filterUpdateConditions) {
        return this.renderQueue.queue(async () => {
            return this.updateFilters(filterUpdateConditions);
        }, 'low', {
            type: 'background',
            operation: 'filterUpdate',
            conditions: filterUpdateConditions
        });
    }

    onContextRecovered(device, context) {
        // Store references to new device/context
        this.app.device = device;
        this.app.context = context;
    }

    updateFilterInputTexture(filterKey, passIndex, bindingIndex, textureKey, textureIndex) {
        this.app.bindingManager.updateFilterInputTexture(
            filterKey,
            passIndex,
            bindingIndex,
            textureKey,
            textureIndex,
            this.filters
        );
    }

    waitForRenderComplete() {
        let id = this.renderCompleteCounter++;
        return new Promise(resolve => {
            this.renderCompleteCallbacks.set(id, resolve);
            // Set timeout to prevent infinite waiting
            setTimeout(() => {
                if (this.renderCompleteCallbacks.has(id)) {
                    console.warn("Render completion timeout triggered");
                    this.renderCompleteCallbacks.delete(id);
                    resolve(); // Resolve anyway to prevent hanging promises
                }
            }, 30000); // 30 seconds timeout
        });
    }

    async clearBuffer(buffer) {
        // Create a temporary buffer to clear the buffer
        const tempBuffer = this.app.device.createBuffer({
            size: buffer.size,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true
        });

        // Fill the temporary buffer with zeros
        new Uint8Array(tempBuffer.getMappedRange()).fill(0);
        tempBuffer.unmap();

        // Create a command encoder
        const commandEncoder = this.app.device.createCommandEncoder();

        // Copy the temporary buffer to the buffer to clear it
        commandEncoder.copyBufferToBuffer(tempBuffer, 0, buffer, 0, buffer.size);

        // Submit the commands
        const commandBuffer = commandEncoder.finish();
        this.app.device.queue.submit([commandBuffer]);
    }

    async updateOutputCanvas(drawToCanvas, transformations, filterUpdateConditions) {
        // Check if we're already inside a queue operation
        if (this.renderQueue.isProcessing) {
            // We're ALREADY inside a queue operation
            // Adding another queue operation would cause:
            // 1. Deadlock (queue waiting for itself)
            // 2. Infinite recursion
            // 3. Queue blocking itself
            try {
                // So we bypass the queue and render directly
                const renderResult = await this.renderFrame(drawToCanvas, transformations, filterUpdateConditions);
                return { success: true, complete: renderResult, error: null };
            } catch (error) {
                console.error('Direct render error:', error);
                return { success: false, complete: false, error: error.message };
            }
        }

        // Not in queue, safe to queue the operation
        try {
            const result = await this.renderQueue.queue(async () => {
                return await this.renderFrame(drawToCanvas, transformations, filterUpdateConditions);
            }, 'high', {
                type: 'render',
                operation: 'updateOutputCanvas',
                conditions: filterUpdateConditions,

            });

            // Log performance occasionally
            if (this.debug && Math.random() < 0.01) { // 1% of the time
                console.log('Queue performance:', this.renderQueue.getPerformanceStats());
            }

            return { success: true, complete: result, error: null };
        } catch (error) {
            console.error('Render error:', error);
            return { success: false, complete: false, error: error.message };
        }
    }

    async renderFrame(drawToCanvas, transformations, filterUpdateConditions) {
        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastFrameTime;

        if (deltaTime < this.frameInterval) {
            return false;
        }

        const breakLoop = await this.updateFilters(filterUpdateConditions);

        if (breakLoop && this.histogramNeedsUpdate && !this.app.videoProcessor?.isProcessingVideo) {
            await this.app.updateHistogram();
            this.histogramNeedsUpdate = false;
        }

        this.drawFrame(drawToCanvas, transformations);
        this.lastFrameTime = currentTime;

        if (breakLoop) {
            this.completeRender();
            return true;
        }

        return false;
    }

    // Clean up updateFilters
    async updateFilters(filterUpdateConditions = false) {
        for (const [key, filter] of Object.entries(this.filters)) {
            if (!filter?.active) continue;

            if (filter.label === filterUpdateConditions?.histogram) {
                this.histogramNeedsUpdate = true;
            }

            const breakLoop = await this.renderFilterPasses(filter);

            if (breakLoop) {
                return true;
            }
        }

        return false;
    }

    drawFrame(drawToCanvas, transformations) {

        const { canvas, ctx } = drawToCanvas;

        // Update canvas dimensions
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;

        // Apply transformations and draw
        ctx.setTransform(
            transformations._layerScale, 0,
            0, transformations._layerScale,
            transformations._x, transformations._y
        );

        ctx.drawImage(this.canvas, 0, 0, canvas.width, canvas.height);

    }

    scheduleNextFrame(drawToCanvas, transformations, filterUpdateConditions) {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        this.animationFrameId = requestAnimationFrame(() => {
            this.updateOutputCanvas(drawToCanvas, transformations, filterUpdateConditions);
        });
    }

    completeRender() {
        this.stopRender();
        // Notify completion
        this.notifyRenderComplete();
    }

    stopRender() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        // Clear any pending render operations
        this.renderQueue.clear();
    }

    notifyRenderComplete() {
        for (const [id, callback] of this.renderCompleteCallbacks.entries()) {

            callback();
            this.renderCompleteCallbacks.delete(id);
        }
    }

}

class Histogram {
    static calculateStatistics(histogram) {
        if (!histogram || histogram.length === 0) {
            return { median: null, min: null, max: null, mean: null, total: 0 };
        }

        const total = histogram.reduce((sum, freq) => sum + freq, 0);
        if (total === 0) {
            return { median: null, min: null, max: null, mean: null, total: 0 };
        }

        let min = null;
        let max = null;
        let sum = 0;
        let medianValue = null;
        const half = total / 2;
        let cumulativeFrequency = 0;

        // First pass: find min, max, and calculate sum for mean
        for (let i = 0; i < histogram.length; i++) {
            if (histogram[i] > 0) {
                if (min === null) min = i;
                max = i;
                sum += i * histogram[i];
            }
        }

        // Second pass: find median
        for (let i = 0; i < histogram.length; i++) {
            cumulativeFrequency += histogram[i];
            if (cumulativeFrequency >= half && medianValue === null) {
                // Interpolate for more accurate median
                const prevCumulative = cumulativeFrequency - histogram[i];
                const fraction = (half - prevCumulative) / histogram[i];
                medianValue = i + fraction;
            }
        }

        return {
            median: medianValue,
            min,
            max,
            mean: sum / total,
            total,
            normalizedHistogram: histogram.map(value => value / total)
        };
    }

    /**
     * Updates histogram data and triggers callback if present
     * @param {WebGpuRenderer} renderer - The WebGPU renderer instance
     * @returns {Promise<Object|null>} Histogram statistics
     */
    static async updateHistogram(renderer) {
        try {
            const stats = await this.readAndAnalyzeHistogram(renderer);
            if (stats && renderer.onHistogramUpdate) {
                renderer.onHistogramUpdate(stats);
            }
            return stats;
        } catch (error) {
            console.error('Error updating histogram:', error);
            return null;
        }
    }

    /**
     * Reads the histogram values from the GPU buffer
     * @param {WebGpuRenderer} renderer - The WebGPU renderer instance
     * @returns {Promise<number[]>} Array of histogram values
     */
    static async readHistogramValues(renderer) {
        // Get histogram filter and validate
        const histogramFilter = renderer.filters.histogramCompute;

        if (!histogramFilter?.resources?.buffer) {
            console.warn('Histogram buffer not initialized, recreating resources');

            if (histogramFilter && !histogramFilter.resources) {
                histogramFilter.resources = await renderer.pipelineManager.createFilterPipeline(histogramFilter);

                if (!histogramFilter?.resources?.buffer) {
                    throw new Error('Histogram buffer could not be recreated');
                }
            }
        }

        try {
            const sourceBuffer = histogramFilter.resources.buffers?.histogram ||
                histogramFilter.resources.buffer;

            // Create buffer for reading data
            const readBackBuffer = renderer.device.createBuffer({
                size: 256 * Float32Array.BYTES_PER_ELEMENT,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                label: 'Histogram ReadBack Buffer'
            });

            // Create and execute command encoder
            const commandEncoder = renderer.device.createCommandEncoder({
                label: 'Read Histogram Values'
            });

            commandEncoder.copyBufferToBuffer(
                sourceBuffer,
                0,
                readBackBuffer,
                0,
                256 * Float32Array.BYTES_PER_ELEMENT
            );

            renderer.device.queue.submit([commandEncoder.finish()]);

            // Map and read the data
            await readBackBuffer.mapAsync(GPUMapMode.READ);
            const mappedRange = readBackBuffer.getMappedRange();
            const histogramData = new Uint32Array(mappedRange);

            // Copy the data to a regular array
            const histogram = Array.from(histogramData);

            // Cleanup
            readBackBuffer.unmap();
            readBackBuffer.destroy();

            return histogram;
        } catch (error) {
            console.error('Error reading histogram values, possible invalid buffer:', error);

            if (error.message && error.message.includes('Invalid Buffer')) {
                console.warn('Detected invalid buffer, triggering resource recreation');
                await renderer.createResources(renderer.imageArray[renderer.imageIndex]?.type === 'Video');
            }

            throw error;
        }
    }

    /**
     * Reads and analyzes histogram data from the GPU
     * @param {WebGpuRenderer} renderer - The WebGPU renderer instance
     * @returns {Promise<Object|null>} Histogram statistics
     */
    static async readAndAnalyzeHistogram(renderer) {
        try {
            const histogramFilter = renderer.filters.histogramCompute;
            if (!histogramFilter?.resources?.buffer) {
                throw new Error('Histogram buffer not initialized');
            }

            const histogramData = await this.readHistogramValues(renderer);

            if (!histogramData || histogramData.length === 0) {
                console.warn('No histogram data received');
                return null;
            }

            const stats = this.calculateStatistics(histogramData);
            stats.rawHistogram = histogramData;

            if (renderer.debug) {
                console.log('Histogram Statistics:', {
                    min: stats.min !== null ? stats.min / 255 : null,
                    max: stats.max !== null ? stats.max / 255 : null,
                    median: stats.median !== null ? stats.median / 255 : null,
                    mean: stats.mean !== null ? stats.mean / 255 : null,
                    total: stats.total
                });
            }

            return stats;
        } catch (error) {
            console.error('Error analyzing histogram:', error);
            throw error;
        }
    }
}

class CommandQueueManager {
    constructor(device) {
        this.device = device;
        this.pendingCommands = [];
        this.activeEncoder = null;
        this.isRecording = false;

        // Simplified configuration
        this.maxBatchSize = 100;  // Maximum commands per batch
    }

    beginRecording() {
        if (this.isRecording) return;

        this.isRecording = true;
        this.activeEncoder = this.device.createCommandEncoder();
    }

    addCommand(command) {
        if (!this.isRecording) {
            this.beginRecording();
        }

        try {
            command(this.activeEncoder);
            this.pendingCommands.push(command);

            // Auto-flush if batch size limit reached
            if (this.pendingCommands.length >= this.maxBatchSize) {
                this.flush();
            }
        } catch (error) {
            console.error('Error executing command:', error);
            throw error;
        }
    }

    addRenderPass(params) {
        this.addCommand(encoder => {
            const renderPass = encoder.beginRenderPass(params.descriptor);
            params.commands(renderPass);
            renderPass.end();
        });
    }

    addComputePass(params) {
        this.addCommand(encoder => {
            const computePass = encoder.beginComputePass(params.descriptor);
            params.commands(computePass);
            computePass.end();
        });
    }

    addTextureCopy(params) {
        this.addCommand(encoder => {
            encoder.copyTextureToTexture(
                params.source,
                params.destination,
                params.copySize
            );
        });
    }

    addBufferCopy(params) {
        this.addCommand(encoder => {
            encoder.copyBufferToBuffer(
                params.source,
                params.sourceOffset || 0,
                params.destination,
                params.destinationOffset || 0,
                params.size
            );
        });
    }

    async flush() {
        try {
            if (!this.isRecording || this.pendingCommands.length === 0) {
                return Promise.resolve();
            }

            const commandBuffer = this.activeEncoder.finish();
            this.device.queue.submit([commandBuffer]);

            this.pendingCommands = [];
            this.activeEncoder = null;
            this.isRecording = false;

            return this.device.queue.onSubmittedWorkDone();
        } catch (error) {
            console.error('Failed to flush command queue', error);
            throw error;
        }
    }

    dispose() {
        if (this.pendingCommands.length > 0) {
            this.flush().catch(console.error);
        }
    }
}

class SettingsValidator {
    static validateSettings(settings) {
        if (!settings.presentationFormat) throw new Error('Presentation format is required.');
        if (!settings.textures) throw new Error('Textures are required.');
        if (!settings.filters) throw new Error('Filters are required.');

        this.validatePresentationFormat(settings.presentationFormat);
        this.validateTextures(settings.textures);
        this.validateFilters(settings.filters);
    }

    static validatePresentationFormat(format) {
        const validFormats = ['rgba8unorm', 'rgba8unorm-srgb', 'bgra8unorm', 'rgba16float'];
        if (!validFormats.includes(format)) {
            throw new Error(`Invalid presentation format: ${format}`);
        }
    }

    static validateTextures(textures) {
        if (!textures || Object.keys(textures).length === 0) {
            throw new Error('No textures defined in settings');
        }

        for (const [key, texture] of Object.entries(textures)) {
            // Validate required properties
            if (!texture.label) {
                throw new Error(`Texture ${key} missing required label property`);
            }

            // Validate format if specified
            if (texture.format) {
                this.validateTextureFormat(key, texture.format);
            }

            // Validate usage flags if specified
            if (texture.usage) {
                this.validateTextureUsage(key, texture.usage);
            }

            // Validate sample count if specified
            if (texture.sampleCount !== undefined) {
                this.validateSampleCount(key, texture.sampleCount);
            }

            // Validate size if specified
            if (texture.size) {
                this.validateTextureSize(key, texture.size);
            }
        }
    }

    static validateTextureFormat(textureKey, format) {
        const validFormats = [
            // Standard color formats
            'rgba8unorm',
            'rgba8unorm-srgb',
            'rgba8snorm',
            'rgba16float',
            'rgba32float',
            'bgra8unorm',
            'bgra8unorm-srgb',
        ];

        if (!validFormats.includes(format)) {
            throw new Error(
                'ValidationError',
                `Invalid texture format '${format}' for texture '${textureKey}'. ` +
                `Valid formats are: ${validFormats.join(', ')}`
            );
        }
    }

    static validateTextureUsage(textureKey, usage) {
        const validUsageFlags = {
            COPY_SRC: GPUTextureUsage.COPY_SRC,
            COPY_DST: GPUTextureUsage.COPY_DST,
            TEXTURE_BINDING: GPUTextureUsage.TEXTURE_BINDING,
            STORAGE_BINDING: GPUTextureUsage.STORAGE_BINDING,
            RENDER_ATTACHMENT: GPUTextureUsage.RENDER_ATTACHMENT
        };

        // Check if usage is a valid combination of flags
        let validCombination = false;
        let usedFlags = [];

        // Check each flag
        for (const [flagName, flagValue] of Object.entries(validUsageFlags)) {
            if (usage & flagValue) {
                usedFlags.push(flagName);
                validCombination = true;
            }
        }

        if (!validCombination) {
            throw new Error(
                `Invalid usage flags for texture '${textureKey}'. ` +
                `No valid usage flags found. Must include at least one of: ${Object.keys(validUsageFlags).join(', ')}`
            );
        }

        // Validate specific combinations
        if ((usage & GPUTextureUsage.STORAGE_BINDING) && (usage & GPUTextureUsage.RENDER_ATTACHMENT)) {
            throw new Error(
                `Invalid usage combination for texture '${textureKey}': ` +
                'STORAGE_BINDING cannot be combined with RENDER_ATTACHMENT'
            );
        }

        // Log used flags for debugging
        console.debug(`Texture '${textureKey}' uses flags: ${usedFlags.join(', ')}`);
    }

    static validateSampleCount(textureKey, sampleCount) {
        const validSampleCounts = [1, 4];

        if (!validSampleCounts.includes(sampleCount)) {
            throw new Error(
                `Invalid sample count '${sampleCount}' for texture '${textureKey}'. ` +
                `Valid sample counts are: ${validSampleCounts.join(', ')}`
            );
        }
    }

    static validateTextureSize(textureKey, size) {
        // Validate width
        if (!Number.isInteger(size.width) || size.width <= 0 || size.width > 16384) {
            throw new Error(
                `Invalid width '${size.width}' for texture '${textureKey}'. ` +
                'Width must be a positive integer not exceeding 16384'
            );
        }

        // Validate height
        if (!Number.isInteger(size.height) || size.height <= 0 || size.height > 16384) {
            throw new Error(
                `Invalid height '${size.height}' for texture '${textureKey}'. ` +
                'Height must be a positive integer not exceeding 16384'
            );
        }

        // Validate depthOrArrayLayers if specified
        if (size.depthOrArrayLayers !== undefined) {
            if (!Number.isInteger(size.depthOrArrayLayers) || size.depthOrArrayLayers <= 0 || size.depthOrArrayLayers > 2048) {
                throw new Error(
                    `Invalid depthOrArrayLayers '${size.depthOrArrayLayers}' for texture '${textureKey}'. ` +
                    'Must be a positive integer not exceeding 2048'
                );
            }
        }

    }

    static isPowerOf2(value) {
        return value > 0 && (value & (value - 1)) === 0;
    }

    static validateFilters(filters) {
        Object.entries(filters).forEach(([key, filter]) => {
            const requiredKeys = ['active', 'passes', 'bufferAttachment'];
            const missingKeys = requiredKeys.filter(k => !filter.hasOwnProperty(k));

            if (missingKeys.length > 0) {
                throw new Error(`Filter "${key}" missing required keys: ${missingKeys.join(', ')}`);
            }

            this.validateFilterPasses(key, filter.passes);
            this.validateBufferAttachment(key, filter.bufferAttachment);
        });
    }

    static validateFilterPasses(filterKey, passes) {
        if (!Array.isArray(passes)) {
            throw new Error(`Passes for filter "${filterKey}" must be an array`);
        }

        passes.forEach((pass, index) => {
            const requiredKeys = ['inputTexture', 'shaderURL'];
            const missingKeys = requiredKeys.filter(k => !pass.hasOwnProperty(k));

            if (missingKeys.length > 0) {
                throw new Error(
                    `Pass ${index} in filter "${filterKey}" missing required keys: ${missingKeys.join(', ')}`
                );
            }

            if (!Array.isArray(pass.inputTexture)) {
                throw new Error(
                    `InputTexture in pass ${index} of filter "${filterKey}" must be an array`
                );
            }
        });
    }

    static validateBufferAttachment(filterKey, attachment) {
        if (attachment) {
            if (attachment.groupIndex === undefined) {
                throw new Error(`Filter "${filterKey}" buffer attachment missing groupIndex`);
            }

            // Check for reserved binding indices
            if (attachment.bindingIndex !== undefined) {
                if (attachment.groupIndex === 0 && (attachment.bindingIndex === 0 || attachment.bindingIndex === 1)) {
                    throw new Error(
                        `Invalid binding configuration in filter "${filterKey}": ` +
                        'group index 0 and binding indices 0 and 1 are reserved'
                    );
                }
            }

            // Validate bindings if they exist
            if (attachment.bindings) {
                this.validateBindings(filterKey, attachment.bindings);
            }
        }
    }

    static validateBindings(filterKey, bindings) {
        Object.entries(bindings).forEach(([bindingKey, binding]) => {
            if (!binding.type) {
                throw new Error(
                    `Binding "${bindingKey}" in filter "${filterKey}" missing required type property`
                );
            }
            if (binding.value === undefined) {
                throw new Error(
                    `Binding "${bindingKey}" in filter "${filterKey}" missing required value property`
                );
            }
        });
    }
}

class RecoveryManager {
    constructor(app) {
        this.app = app;
        this.isRecovering = false;
        this.recoveryAttempts = 0;
        this.maxRecoveryAttempts = 5;
        this.retryDelay = 5000; // 5 seconds between recovery attempts
        this.overlayElement = null;
        this.statusElement = null;
        this.progressInterval = null;
        this.recoveryListeners = new Set();

        // Listen for uncaptured errors from the device
        this._setupDeviceErrorListener();
    }

    /**
     * Set up error listener on the device to auto-trigger recovery
     * @private
     */
    _setupDeviceErrorListener() {
        if (this.app && this.app.device) {
            this.app.device.addEventListener('uncapturederror', (event) => {
                console.error('WebGPU device error:', event.error);

                // If this is a device lost error, trigger recovery
                if (event.error.constructor.name === 'GPUDeviceLostInfo') {
                    console.warn('Device explicitly reported as lost, initiating recovery');
                    this.startRecovery();
                }
            });
        }
    }

    /**
     * Add a recovery listener to be notified when recovery completes
     * @param {Function} listener - Callback function when recovery completes
     */
    addRecoveryListener(listener) {
        if (typeof listener === 'function') {
            this.recoveryListeners.add(listener);
        }
    }

    /**
     * Remove a recovery listener
     * @param {Function} listener - Listener to remove
     */
    removeRecoveryListener(listener) {
        this.recoveryListeners.delete(listener);
    }

    /**
     * Notify all recovery listeners
     * @param {boolean} success - Whether recovery was successful
     * @param {Error} error - Error object if recovery failed
     * @private
     */
    _notifyListeners(success, error = null) {
        this.recoveryListeners.forEach(listener => {
            try {
                listener(success, error);
            } catch (e) {
                console.error('Error in recovery listener:', e);
            }
        });
    }

    /**
     * Start the recovery process
     */
    async startRecovery() {
        if (this.isRecovering) {
            console.log('Recovery already in progress, ignoring request');
            return;
        }

        this.isRecovering = true;
        this.recoveryAttempts++;

        try {
            // Create blocking overlay first to prevent user interaction
            this.overlayElement = this._createBlockingOverlay(true);

            // Create or update recovery notification with custom message
            this.statusElement = this._createRecoveryStatusElement(
                '<h3 style="margin: 0 0 10px 0; font-size: 28px;">WebGPU Recovery</h3>' +
                '<p style="margin-bottom: 20px; font-size: 18px;">Recovering graphics context...</p>' +
                '<div style="width: 100%; height: 8px; margin-top: 15px; background: #222; border-radius: 4px; overflow: hidden;">' +
                '<div id="recovery-progress" style="width: 0%; height: 100%; background: linear-gradient(90deg, #0f6, #0c9); border-radius: 4px; transition: width 0.3s ease-in-out;"></div></div>',
                'recovery'
            );

            // Add a pulsing animation
            this._addPulsingAnimation();

            // Simulate progress updates during recovery
            let progress = 0;
            const progressEl = document.getElementById('recovery-progress');
            this.progressInterval = setInterval(() => {
                progress += 5;
                if (progressEl && progress <= 90) {
                    progressEl.style.width = `${progress}%`;
                }
            }, 2000);

            // Clean up resources but don't mark as disposed yet
            await this._cleanupResources();

            // Update progress message
            if (this.statusElement) this.statusElement.querySelector('p').textContent = 'Requesting new WebGPU adapter...';

            // Get a new adapter and device
            await this._recreateAdapterAndDevice();

            // Update progress message
            if (this.statusElement) this.statusElement.querySelector('p').textContent = 'Reconfiguring context...';

            // Reconfigure context with new device
            await this._reconfigureContext();

            // Update progress message
            if (this.statusElement) this.statusElement.querySelector('p').textContent = 'Recreating resources...';

            // Recreate essential managers and resources
            await this._recreateResources();

            // Fix any filters that might have invalid state
            this._validateAndFixFilters();

            // Notify the RenderManager that context has been recovered
            this._recoveryNotification();

            // Complete progress
            if (progressEl) progressEl.style.width = '100%';
            this._clearProgressInterval();

            // Update status with success styling
            this._showSuccessMessage();

            // Reset recovery attempts on success
            this.recoveryAttempts = 0;
            this.isRecovering = false;

            // Notify listeners of successful recovery
            this._notifyListeners(true);

            return true;
        } catch (error) {
            console.error('Context recovery failed:', error);

            // Clear progress interval if it exists
            this._clearProgressInterval();

            // Update status indicator with error
            this._showErrorMessage(error);

            // Don't remove overlay on failure - keep it until the retry succeeds or user refreshes the page

            // Notify listeners of failed recovery
            this._notifyListeners(false, error);

            // Check if we should retry
            if (this.recoveryAttempts < this.maxRecoveryAttempts) {
                console.log(`Recovery attempt ${this.recoveryAttempts} failed. Retrying in ${this.retryDelay / 1000} seconds...`);

                // Set a timeout to retry recovery after a delay
                setTimeout(() => {
                    console.log('Retrying recovery...');
                    this.isRecovering = false; // Reset flag to allow retry
                    this.startRecovery();
                }, this.retryDelay);
            } else {
                console.error(`Max recovery attempts (${this.maxRecoveryAttempts}) reached. Recovery failed.`);
                // Show fatal error message
                this._showFatalErrorMessage();
                this.isRecovering = false;
            }

            return false;
        }
    }

    /**
     * Show fatal error message when max recovery attempts are reached
     * @private
     */
    _showFatalErrorMessage() {
        if (this.statusElement) {
            this.statusElement.style.backgroundColor = 'rgba(120, 0, 0, 0.9)';
            this.statusElement.innerHTML = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery Failed</h3>' +
                '<p>Maximum recovery attempts reached.</p>' +
                '<p>Please refresh the page or restart your browser.</p>' +
                '<button id="refresh-page-btn" style="margin-top: 15px; padding: 8px 16px; background: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Refresh Page</button>';

            // Add refresh button handler
            setTimeout(() => {
                const refreshBtn = document.getElementById('refresh-page-btn');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        window.location.reload();
                    });
                }
            }, 0);
        }
    }

    /**
     * Clean up WebGPU resources before recovery
     * @private
     */
    async _cleanupResources() {
        try {
            await this.app.waitForGPU();
            await this.app.cleanupResources('bindGroups');
            await this.app.cleanupResources('pipelines');
            await this.app.cleanupResources('textures');
            await this.app.cleanupResources('buffers');
        } catch (error) {
            console.warn('Error during resource cleanup:', error);
            // Continue recovery process despite cleanup errors
        }
    }

    /**
     * Recreate adapter and device
     * @private
     */
    async _recreateAdapterAndDevice() {
        // Get a new adapter
        this.app.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance',
            forceFallbackAdapter: false
        });

        if (!this.app.adapter) {
            throw new Error('Could not acquire WebGPU adapter during recovery');
        }

        // Create new device
        this.app.device = await this.app.adapter.requestDevice();

        // Set up error handler for the new device
        this.app.device.addEventListener('uncapturederror', (event) => {
            console.error('WebGPU device error:', event.error);
            if (event.error.constructor.name === 'GPUDeviceLostInfo') {
                console.warn('Device explicitly reported as lost, initiating recovery');
                this.startRecovery();
            }
        });
    }

    /**
     * Reconfigure WebGPU context
     * @private
     */
    async _reconfigureContext() {
        if (this.app.context) {
            try {
                this.app.context.unconfigure();
            } catch (e) {
                console.warn('Error unconfiguring context:', e);
            }

            this.app.context.configure({
                device: this.app.device,
                format: this.app.presentationFormat,
                alphaMode: 'premultiplied',
                size: {
                    width: this.app.canvas.width,
                    height: this.app.canvas.height
                }
            });
        }
    }

    /**
     * Recreate managers and resources
     * @private
     */
    async _recreateResources() {
        try {
            // First, fully clean up any remaining buffers that might still be referenced
            await this.app.cleanupResources('bindGroups');
            await this.app.cleanupResources('pipelines');
            await this.app.cleanupResources('textures');
            await this.app.cleanupResources('buffers');

            // Clear all resource tracking sets
            for (const type in this.app.resources) {
                this.app.resources[type].clear();
            }

            // Reset managers to null to ensure we don't keep any references to old device
            this.app.textureManager = null;
            this.app.bindingManager = null;
            this.app.bufferManager = null;
            this.app.pipelineManager = null;
            this.app.commandQueue = null;

            // Create new device
            await this.app.setupDevice();

            // Recreate resources from scratch with the new device
            const isVideo = this.app.imageArray[this.app.imageIndex]?.type === 'Video';

            // Make sure we reload the image/video before recreating resources
            if (isVideo) {
                if (!this.app.videoProcessor) {
                    this.app.videoProcessor = new VideoProcessor(this.app);
                    await this.app.videoProcessor.initializeVideo(this.app.imageArray[this.app.imageIndex].filePath);
                }
            } else {
                // Reload the image
                let response = await fetch(this.app.imageArray[this.app.imageIndex].filePath);
                let blob = await response.blob();
                let url = URL.createObjectURL(blob);
                await this.app.loadImageSource(url);
            }

            // Now create all resources with the new device
            await this.app.createResources(isVideo);

            console.log('Resources recreated successfully with new device');
        } catch (error) {
            console.error('Error in _recreateResources:', error);
            throw error;
        }
    }

    /**
     * Validate and fix filters after recovery
     * @private
     */
    _validateAndFixFilters() {
        let needsRebuild = false;

        // Check all filters and passes for validity
        for (const [key, filter] of Object.entries(this.app.filters)) {
            if (!filter.passes || !Array.isArray(filter.passes)) {
                console.warn(`Filter ${key} has invalid passes array`);
                continue;
            }

            for (const pass of filter.passes) {
                // Skip inactive passes
                if (!pass.active) continue;

                // Check if pass needs its bind group recreated
                if (!pass.bindGroup || !pass.bindGroup[0] || !pass.pipeline) {
                    console.log(`Fixing invalid bind group for pass: ${pass.label || 'unnamed'}`);
                    needsRebuild = true;

                    // If pipeline exists but bind group doesn't, try to rebuild just the bind group
                    if (pass.pipeline && this.app.bindingManager) {
                        try {
                            // Create temporary bind group using pipeline layout
                            const tempBindGroup = this.app.device.createBindGroup({
                                layout: pass.pipeline.getBindGroupLayout(0),
                                entries: [
                                    {
                                        binding: 0,
                                        resource: this.app.device.createSampler({
                                            magFilter: 'linear',
                                            minFilter: 'linear'
                                        })
                                    },
                                    // Add a basic texture binding
                                    {
                                        binding: 1,
                                        resource: this.app.textureManager.getTexture('texture').createView()
                                    }
                                ]
                            });

                            // Set temporary bind group
                            pass.bindGroup = [tempBindGroup];
                            console.log(`Created temporary bind group for ${pass.label || 'unnamed'} pass`);
                        } catch (error) {
                            console.warn(`Could not create temporary bind group: ${error.message}`);
                        }
                    }
                }
            }
        }

        return needsRebuild;
    }

    /**
     * Notify renderManager about successful recovery
     * @private
     */
    _recoveryNotification() {
        if (this.app) {
            if (typeof this.app.handleContextRecovery === 'function') {
                // Call the handler method on RenderManager
                this.app.handleContextRecovery();
                console.log('Notified RenderManager about context recovery');
            }
            else {
                console.warn('App "handleContextRecovery" fuction not available for notification');
            }
        } else {
            console.warn('"App" not available for notification');
        }
    }

    /**
     * Clear progress interval
     * @private
     */
    _clearProgressInterval() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    /**
     * Show success message after recovery
     * @private
     */
    _showSuccessMessage() {
        if (this.statusElement) {
            this.statusElement.style.backgroundColor = 'rgb(10, 160, 10)';
            this.statusElement.style.boxShadow = '0 0 10px rgba(128, 128, 128, 0.5)';
            this.statusElement.innerHTML = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery</h3>' +
                '<p>GPU Context Successfully Recovered!</p>';

            // Remove pulsing animation
            this.statusElement.style.animation = 'none';

            // Auto-hide after a few seconds
            setTimeout(() => {
                if (this.statusElement) {
                    this.statusElement.style.opacity = '0';
                    // Remove overlay when status message fades out
                    if (this.overlayElement) this.overlayElement.style.opacity = '0';

                    // Remove both elements from DOM after fade out
                    setTimeout(() => {
                        // Remove style element
                        const styleEl = document.getElementById('recovery-animation');
                        if (styleEl) styleEl.parentNode.removeChild(styleEl);

                        // Remove overlay
                        if (this.overlayElement && this.overlayElement.parentNode) {
                            this.overlayElement.parentNode.removeChild(this.overlayElement);
                            this.overlayElement = null;
                        }

                        // Status element will be removed by the calling code
                        this.statusElement = null;
                    }, 500);
                }
            }, 1000);
        }
    }

    /**
     * Show error message when recovery fails
     * @param {Error} error - The error that caused recovery to fail
     * @private
     */
    _showErrorMessage(error) {
        if (this.statusElement) {
            this.statusElement.style.backgroundColor = 'rgba(220, 53, 69, 0.9)';
            this.statusElement.innerHTML = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery Failed</h3>' +
                `<p>${error.message || 'Unknown error occurred'}</p>` +
                `<p style="margin-top: 10px;">Retrying in ${this.retryDelay / 1000} seconds... (Attempt ${this.recoveryAttempts}/${this.maxRecoveryAttempts})</p>`;
        }
    }

    /**
     * Add pulsing animation to status element
     * @private
     */
    _addPulsingAnimation() {
        const pulseAnimation = `@keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7); }
            70% { box-shadow: 0 0 0 15px rgba(255, 0, 0, 0); }
            100% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0); }
        }`;

        const style = document.createElement('style');
        style.id = 'recovery-animation';
        style.innerHTML = pulseAnimation;
        document.head.appendChild(style);

        if (this.statusElement) {
            this.statusElement.style.animation = 'pulse 1.5s infinite';
        }
    }

    /**
     * Create a blocking overlay
     * @param {boolean} show - Whether to show or hide the overlay
     * @returns {HTMLElement} The overlay element
     * @private
     */
    _createBlockingOverlay(show = true) {
        // Remove existing overlay if it exists
        let overlayEl = document.getElementById('recovery-overlay');
        if (overlayEl) {
            overlayEl.remove();
        }

        if (!show) return null;

        // Create new overlay
        overlayEl = document.createElement('div');
        overlayEl.id = 'recovery-overlay';

        // Style the overlay to cover the entire screen
        overlayEl.style.position = 'fixed';
        overlayEl.style.top = '0';
        overlayEl.style.left = '0';
        overlayEl.style.width = '100%';
        overlayEl.style.height = '100%';
        overlayEl.style.backgroundColor = 'rgba(240, 240, 240, 0.5)';
        overlayEl.style.backdropFilter = 'blur(3px)';
        overlayEl.style.zIndex = '9999'; // Below the status but above everything else
        overlayEl.style.display = 'flex';
        overlayEl.style.justifyContent = 'center';
        overlayEl.style.alignItems = 'center';
        overlayEl.style.transition = 'opacity 0.3s ease';

        document.body.appendChild(overlayEl);
        return overlayEl;
    }

    /**
     * Create recovery status element
     * @param {string} message - Optional message to display
     * @param {string} status - Optional status (success, warning, error, recovery)
     * @param {Error|string} errorDetails - Optional error object or message for error
     * @returns {HTMLElement} The recovery status element
     * @private
     */
    _createRecoveryStatusElement(message = '', status = 'hidden', errorDetails = null) {
        // Remove existing element if it exists
        let statusEl = document.getElementById('recovery-status');
        if (statusEl) {
            statusEl.remove();
        }

        // Create new element
        statusEl = document.createElement('div');
        statusEl.id = 'recovery-status';

        // Base styling
        statusEl.style.position = 'fixed';
        statusEl.style.top = '50%';
        statusEl.style.left = '50%';
        statusEl.style.transform = 'translate(-50%, -50%)';
        statusEl.style.padding = '20px 30px';
        statusEl.style.borderRadius = '8px';
        statusEl.style.zIndex = '10000';
        statusEl.style.textAlign = 'center';
        statusEl.style.fontFamily = 'Arial, sans-serif';
        statusEl.style.fontSize = '24px';
        statusEl.style.transition = 'all 0.3s ease';
        statusEl.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.3)';
        statusEl.style.minWidth = '300px';

        // Status-specific styling
        if (status === 'error') {
            statusEl.style.backgroundColor = 'rgba(220, 53, 69, 0.9)';
            statusEl.style.color = '#fff';
            // Use provided message or generate default error message
            if (!message) {
                const errorMsg = errorDetails ?
                    (errorDetails.message || errorDetails.toString() || 'Unknown error occurred') :
                    'Unknown error occurred';

                message = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery Failed</h3>' +
                    `<p>${errorMsg}</p>` +
                    `<p style="margin-top: 10px;">Retrying in ${this.retryDelay / 1000} seconds...</p>`;
            }
        } else if (status === 'warning') {
            statusEl.style.backgroundColor = 'rgba(255, 193, 7, 0.9)';
            statusEl.style.color = '#212529';
            if (!message) {
                message = '<h3 style="margin: 0 0 10px 0;">WebGPU Warning</h3>' +
                    '<p>Performance may be affected</p>';
            }
        } else if (status === 'success') {
            statusEl.style.backgroundColor = 'rgba(40, 167, 69, 0.9)';
            statusEl.style.color = '#fff';
            if (!message) {
                message = '<h3 style="margin: 0 0 10px 0;">Success</h3>' +
                    '<p>Operation completed successfully</p>';
            }
        } else if (status === 'recovery') {
            statusEl.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
            statusEl.style.color = '#fff';
            if (!message) {
                message = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery</h3>' +
                    '<p>Recovering from GPU context loss...</p>' +
                    '<div style="width: 100%; height: 4px; margin-top: 15px; background: #333;">' +
                    '<div id="recovery-progress" style="width: 0%; height: 100%; background: #0f6"></div></div>';
            }
        } else {
            // Hidden or default style
            statusEl.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            statusEl.style.color = '#fff';
            statusEl.style.opacity = '0';
            statusEl.style.pointerEvents = 'none';
        }

        // Set content
        if (message) {
            statusEl.innerHTML = message;
        } else {
            statusEl.innerHTML = '<h3 style="margin: 0 0 10px 0;">WebGPU Status</h3>' +
                '<p>Ready</p>';
        }

        document.body.appendChild(statusEl);
        return statusEl;
    }

    /**
     * Create a test button for manual recovery testing
     * @returns {HTMLElement} The test button
     */
    createTestButton() {
        let testButton = document.getElementById('test-webgpu-recovery');

        if (testButton) {
            testButton.remove();
        }

        testButton = document.createElement('button');
        testButton.id = 'test-webgpu-recovery';
        testButton.innerText = 'Test WebGPU Recovery';
        testButton.style.position = 'absolute';
        testButton.style.top = '10px';
        testButton.style.right = '10px';
        testButton.style.zIndex = '9999';
        testButton.style.backgroundColor = 'white';
        testButton.style.border = '1px solid black';
        testButton.style.padding = '5px 10px';

        testButton.addEventListener('click', async () => {
            console.log("Manual device recovery test initiated");

            // Forcibly destroy the device to simulate loss
            if (this.app.device) {
                console.log("Destroying WebGPU device to simulate loss...");
                this.app.device.destroy();

                // Start recovery process
                await this.startRecovery();
            }
        });

        document.body.appendChild(testButton);
        return testButton;
    }
}

class DebugLogger {
    constructor(enabled = false) {
        this.enabled = enabled;
        this.loggers = new Map();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
    }

    log(component, message, data = null) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${component}] ${message}`;

        if (data) {
            console.log(logMessage, data);
        } else {
            console.log(logMessage);
        }
    }

    warn(component, message, data = null) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${component}] ⚠️ ${message}`;

        if (data) {
            console.warn(logMessage, data);
        } else {
            console.warn(logMessage);
        }
    }

    error(component, message, error = null) {
        // Always log errors, regardless of debug setting
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${component}] 🚫 ${message}`;

        if (error) {
            console.error(logMessage, error);
        } else {
            console.error(logMessage);
        }
    }
}

class WebGpuRenderer {
   constructor(settings) {

      // ESSENTIAL SETTINGS BELOW
      this.imageIndex = settings.imageIndex;
      this.imageArray = settings.imageArray;

      this.presentationFormat = settings.presentationFormat || navigator.gpu.getPreferredCanvasFormat(); // Default format

      this.textures = { ...settings.textures };

      // Add default textures if not provided
      this._setupDefaultTextures();

      this.filters = settings.filters;

      // Validate settings before proceeding
      try {
         SettingsValidator.validateSettings(settings);
      } catch (error) {
         console.error('Settings validation failed:', error.message);
         throw error;
      }
      this.textureManager = null; // Will be initialized after device setup
      this.bufferManager = null; // Will be initialized after device setup
      this.pipelineManager = null; // Will be initialized after device setup
      this.bindingManager = null; // Will be initialized after device setup
      this.filterManager = null; // Will be initialized after device setup
      this.commandQueue = null; // Will be initialized after device setup
      this.videoProcessor = null; // Will be initialized after device setup


      this.canvas = document.createElement('canvas');
      this.canvas.width = 800;
      this.canvas.height = 800;
      this.canvas.id = 'webgpu-canvas';
      this.canvas.style.display = 'none';
      this.context = undefined;

      this.ratio = 1.0;
      this.image = {
         width: 0,
         height: 0,
      };

      // Add resource tracking
      this.resources = {
         buffers: new Set(),
         textures: new Set(),
         bindGroups: new Set(),
         pipelines: new Set()
      };

      this.isDisposed = false; // Add disposal flag

      this.debug = settings.debug || false;
      // DEBUG
      // Only enable in development/debug mode
      this.debugLogger = new DebugLogger(settings.debug);
      // Example debug log
      if (settings.debug) {
         this.debugLogger.log('App', 'Initializing with settings:', settings);
      }      // Modify the monitoring interval
      if (settings.debug) {
         this.monitoringInterval = setInterval(() => {
            this.debugLogger.log('Performance', 'Current Stats', {
               pipelineCache: this.pipelineManager?.getCacheStats(),
               commandQueue: this.commandQueue?.stats
            });
         }, 10000);
      }
      // Add disposal event listeners
      window.addEventListener('beforeunload', this._cleanup.bind(this));

   }

   /**
     * Setup default textures required for rendering pipeline
     * @private
     */
   _setupDefaultTextures() {
      // Setup primary texture for input image
      if (!this.textures.texture) {
         this.textures.texture = {
            copyImageTo: true,
            label: 'texture',
            notes: 'Primary texture for the input image/video frame. DO NOT WRITE OVER IT',
         };
      }

      // Setup multi-sample texture for anti-aliasing
      if (!this.textures.textureMASS) {
         this.textures.textureMASS = {
            label: 'textureMASS',
            notes: 'Texture used by colorAttachments in renderPass for Multi Sampling',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            sampleCount: 4,
         };
      }

      // Setup temporary texture for intermediate processing
      if (!this.textures.textureTemp) {
         this.textures.textureTemp = {
            label: 'textureTemp',
            notes: 'Temporary texture for output before copying back to the input texture',
         };
      }
   }

   /**
    * Clean up resources on page unload
    * @private
    */
   async _cleanup() {
      try {
         if (!this.isDisposed) {
            await this.dispose();
         }
      } catch (error) {
         console.error('Error during cleanup:', error);
      }
   }


   /**
    * Dispose of all resources and cleanup
    */
   async dispose() {
      if (this.isDisposed) {
         return;
      }

      try {
         // Stop video processing
         if (this.videoProcessor) {
            this.videoProcessor.dispose();
            this.videoProcessor = null;
         }

         // Clear command queue
         if (this.commandQueue) {
            await this.commandQueue.flush();
            this.commandQueue.dispose();
         }

         // Wait for GPU operations
         await this.waitForGPU();

         // Clean up resources in order
         await this.cleanupResources('bindGroups');
         await this.cleanupResources('pipelines');
         await this.cleanupResources('textures');
         await this.cleanupResources('buffers');

         // Clean up texture manager
         if (this.textureManager) {
            await this.textureManager.destroyTextures();
         }

         // Clean up vertex buffers
         if (this.positionBuffer) {
            this.positionBuffer.destroy();
            this.positionBuffer = null;
         }

         if (this.texCordBuffer) {
            this.texCordBuffer.destroy();
            this.texCordBuffer = null;
         }

         // Clean up context and device
         if (this.context) {
            this.context.unconfigure();
         }

         if (this.device) {
            this.device.destroy();
         }

         // Clean up pipeline manager
         if (this.pipelineManager) {
            this.pipelineManager.dispose();
         }

         // Clear all managers
         this.textureManager = null;
         this.bufferManager = null;
         this.pipelineManager = null;
         this.bindingManager = null;

         // Clean up RecoveryManager
         if (this.recoveryManager) {
            this.recoveryManager._clearProgressInterval();

            // Remove any UI elements
            if (this.recoveryManager.overlayElement) {
               this.recoveryManager.overlayElement.remove();
               this.recoveryManager.overlayElement = null;
            }

            if (this.recoveryManager.statusElement) {
               this.recoveryManager.statusElement.remove();
               this.recoveryManager.statusElement = null;
            }

            this.recoveryManager = null;
         }

         this.isDisposed = true;

         // Remove event listeners
         window.removeEventListener('beforeunload', this._cleanup.bind(this));

      } catch (error) {
         console.error('Error during cleanup:', error);
      }
   }


   trackResource(type, resource) {
      if (this.resources[type]) {
         this.resources[type].add(resource);
      }
   }

   createTrackedBuffer(descriptor) {
      const buffer = this.device.createBuffer(descriptor);
      this.trackResource('buffers', buffer);
      return buffer;
   }

   /**
    * Clean up specific resources
    * @param {string} type - Type of resources to clean up
    * @private
    */
   async cleanupResources(type) {
      if (this.resources[type]) {
         for (const resource of this.resources[type]) {
            try {
               if (resource && !resource.destroyed) {
                  if (typeof resource.destroy === 'function') {
                     resource.destroy();
                  }
               }
            } catch (error) {
               console.warn(`Error destroying ${type} resource:`, error);
            }
         }
         this.resources[type].clear();
      }
   }

   /**
    * Wait for the GPU to complete all pending operations
    * @private
    */
   async waitForGPU() {
      if (this.device) {
         try {
            await this.device.queue.onSubmittedWorkDone();
         } catch (error) {
            console.warn('Error waiting for GPU:', error);
         }
      }
   }

   // Reset the application state and resources
   async reset() {
      try {

         // Store current filter values before disposing resources
         const savedFilterValues = {};

         // Recursively extract all properties with 'value' in filters
         const extractValues = (obj, path = '') => {
            for (const key in obj) {
               if (obj[key] && typeof obj[key] === 'object') {
                  // If this property has a 'value' attribute, save it
                  if (obj[key].hasOwnProperty('value')) {
                     const fullPath = path ? `${path}.${key}` : key;
                     savedFilterValues[fullPath] = obj[key].value;
                  }

                  // Continue recursively exploring nested objects
                  if (!Array.isArray(obj[key])) {
                     extractValues(obj[key], path ? `${path}.${key}` : key);
                  }
               }
            }
         };

         // Extract values from all filters
         extractValues(this.filters);

         // Dispose of current resources
         await this.dispose();

         let response = await fetch(this.imageArray[this.imageIndex].filePath);
         let blob = await response.blob();
         let url = URL.createObjectURL(blob);

         await this.loadImageSource(url);
         await this.setupDevice();
         await this.createResources();

         // Restore saved filter values
         for (const key in savedFilterValues) {
            try {
               await this.updateFilterBuffer(key.split('.').pop(), savedFilterValues[key]);
            } catch (err) {
               console.warn(`Failed to restore filter value for ${key}:`, err);
            }
         }

         this.isDisposed = false;
      } catch (error) {
         console.error('Error resetting app:', error);
         throw error;
      }
   }

   /**
    * Load an image source (URL or Blob) into memory
    * @param {string|Blob} source - Image source URL or Blob
    * @returns {Promise<HTMLImageElement>} - Loaded image element
    */
   async loadImageSource(source) {
      try {
         // Create image and load it
         const img = new Image();

         return new Promise((resolve, reject) => {
            img.onload = () => {
               this.image = img;

               // Revoke object URL if needed
               if (typeof source !== 'string' || source.startsWith('blob:')) {
                  URL.revokeObjectURL(source);
               }

               resolve(img);
            };

            img.onerror = (error) => reject(error);
            img.src = source;
         });
      } catch (error) {
         console.error(`Failed to load image source`, error);
         throw error;
      }
   }


   // Resize with proper resource cleanup
   async resize(width, height, resetSize = false) {
      try {
         if (this.debug) {
            console.log('Resizing application from:', this.canvas.width, this.canvas.height, 'to:', width, height, resetSize);
         }

         // Wait for GPU to complete pending work
         await this.waitForGPU();

         // Check if video processor exists and if current file is video
         let isVideo = this.imageArray[this.imageIndex].type === 'Video';

         // Store video state if it's a video
         let videoState = null;
         if (isVideo && this.videoProcessor?.videoElement) {
            videoState = {
               currentTime: this.videoProcessor.videoElement.currentTime,
               paused: this.videoProcessor.videoElement.paused
            };
            // Pause video during resize to prevent frame changes
            this.videoProcessor.videoElement.pause();
         }

         // Get current dimensions based on source type
         const currentWidth = isVideo ? this.videoProcessor.videoElement.videoWidth : this.image.width;
         const currentHeight = isVideo ? this.videoProcessor.videoElement.videoHeight : this.image.height;

         // Calculate new ratio
         if (!resetSize) {
            this.ratio = 1.0;
         } else {
            let widthRatio = width / currentWidth;
            let heightRatio = height / currentHeight;
            this.ratio = Math.min(widthRatio, heightRatio);
         }

         // Store cache state before resizing
         if (this.pipelineManager) {
            const pipelineCacheState = this.pipelineManager.pipelineCacheManager.storeCacheState();

            // Release all active textures back to the pool
            const activeTextureKeys = Array.from(this.textureManager.activeTextures.keys());
            for (const key of activeTextureKeys) {
               this.textureManager.releaseTexture(key);
            }

            // Recreate resources
            await this.createResources(isVideo);

            // Restore compatible cached items with new dimensions
            await this.pipelineManager.pipelineCacheManager.restoreCacheState(
               pipelineCacheState,
               {
                  width: this.canvas.width,
                  height: this.canvas.height
               }
            );
         } else {
            // If no pipeline manager exists, just create resources
            await this.createResources(isVideo);
         }

         // Restore video state if it was a video
         if (videoState && this.videoProcessor?.videoElement) {
            this.videoProcessor.videoElement.currentTime = videoState.currentTime;
            if (!videoState.paused) {
               await this.videoProcessor.videoElement.play();
            }
         }

         if (this.debug) {
            console.log('Resized canvas to:', this.canvas.width, this.canvas.height, resetSize);
         }

         return true;
      } catch (error) {
         console.error('Failed to resize application:', error);
         throw error;
      }
   }


   /**
    * Create the position buffer and write the data to it
    * The coordinates in the position buffer represent
    * the positions of the vertices of a triangle in normalized device coordinates (NDC).
    * These coordinates are used to draw the triangle in the WebGPU rendering pipeline.
    * @returns {Promise<void>}
    */
   createPositionBuffer() {
      // Create the bindings for both position and texture coordinates
      this.bindingManager.createBindings(); // No resource needed yet

      // Create tracked buffer with COPY_SRC usage
      this.positionBuffer = this.createTrackedBuffer({
         size: 24,
         usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      // Fullscreen triangle
      this.device.queue.writeBuffer(this.positionBuffer, 0, new Float32Array([
         -1, -1, // x, y,
         3, -1,  // x, y,
         -1, 3   // x, y,
      ]));
   }

   /**
    * Create the texCord buffer and write the data to it
    * the texCord buffer is used to draw the triangle and
    * represent the texture coordinates for the vertices of a triangle.
    * These coordinates are used to map the texture onto the triangle
    * in the WebGPU rendering pipeline.
    * @returns {Promise<void>}
    */
   createTexCordBuffer() {
      const key = Object.keys(this.textures)
         .find(key => this.textures[key].copyImageTo);
      key ? this.textureManager.getTexture(key).createView() : undefined;

      // Create tracked buffer
      this.texCordBuffer = this.createTrackedBuffer({
         size: 24,
         usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      // Position and uvs for fullscreen triangle
      this.device.queue.writeBuffer(this.texCordBuffer, 0, new Float32Array([
         0, 1, // uvx, uvy
         2, 1, // uvx, uvy
         0, -1 // uvx, uvy
      ]));
   }

   async updateHistogram() {
      return Histogram.updateHistogram(this);
   }

   async setupDevice() {
      try {

         // Request adapter with more robust features
         this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance',
            forceFallbackAdapter: false
         });

         if (!this.adapter) {
            throw new Error('No WebGPU adapter found');
         }

         // Request device with options that might help persistence
         this.device = await this.adapter.requestDevice({
            requiredFeatures: [
               // Any features your app needs
            ],
            requiredLimits: {
               // Any specific limits your app needs
            }
         });

         if (this.imageArray[this.imageIndex]) {
            let name = this.imageArray[this.imageIndex].name;
            this.adapter.label = name;
            this.device.label = name;
         }

         // Setup error handler
         this.device.addEventListener('uncapturederror', (event) => {
            console.error('WebGPU device error:', event.error);
            if (event.error.constructor.name === 'GPUDeviceLostInfo') {
               console.warn('Device explicitly reported as lost, initiating recovery');
               this.recoverRenderContext();
            }
         });

         this.textureManager = new TextureManager(this);
         this.bindingManager = new BindingManager(this);
         this.bufferManager = new BufferManager(this.device);
         this.pipelineManager = new PipelineManager(this);
         this.commandQueue = new CommandQueueManager(this.device);

      }
      catch (error) {
         console.error(`Failed to setup device: ${error}`);
      }
   }

   // Add this helper method to validate and fix filters after recovery
   validateAndFixFilters() {
      let needsRebuild = false;

      // Check all filters and passes for validity
      for (const [key, filter] of Object.entries(this.filters)) {
         if (!filter.passes || !Array.isArray(filter.passes)) {
            console.warn(`Filter ${key} has invalid passes array`);
            continue;
         }

         for (const pass of filter.passes) {
            // Skip inactive passes
            if (!pass.active) continue;

            // Check if pass needs its bind group recreated
            if (!pass.bindGroup || !pass.bindGroup[0] || !pass.pipeline) {
               needsRebuild = true;

               // If pipeline exists but bind group doesn't, try to rebuild just the bind group
               if (pass.pipeline && this.bindingManager) {
                  try {
                     // Create temporary bind group using pipeline layout
                     const tempBindGroup = this.device.createBindGroup({
                        layout: pass.pipeline.getBindGroupLayout(0),
                        entries: [
                           {
                              binding: 0,
                              /*resource: this.device.createSampler({
                                 magFilter: 'linear',
                                 minFilter: 'linear'
                              })*/
                             resource: GPUUtils.createStandardSampler(this.device)
                           },
                           // Add a basic texture binding - we'll get a more accurate one when filters run
                           {
                              binding: 1,
                              resource: this.textureManager.getTexture('texture').createView()
                           }
                        ]
                     });

                     // Set temporary bind group
                     pass.bindGroup = [tempBindGroup];
                  } catch (error) {
                     console.warn(`Could not create temporary bind group: ${error.message}`);
                  }
               }
            }
         }
      }

      return needsRebuild;
   }

   // Add this as a helper method to WebGpuRenderer
   async safeQueueFlush() {
      if (!this.commandQueue) {
         console.warn('Cannot flush: Command queue is null');
         return;
      }

      try {
         // Check if there are any pending commands
         if (this.commandQueue.pendingCommands &&
            this.commandQueue.pendingCommands.length > 0) {
            await this.commandQueue.flush();
            //console.log('Command queue flushed successfully');
         } else {
            //console.log('No pending commands to flush');
         }
      } catch (error) {
         console.error('Error flushing command queue:', error);
      }
   }

   /**
    * Creates a full-screen overlay to block UI interactions during recovery
    * @param {boolean} show - Whether to show or hide the overlay
    * @returns {HTMLElement} The blocking overlay element
    */
   createBlockingOverlay(show = true) {
      // Remove existing overlay if it exists
      let overlayEl = document.getElementById('recovery-overlay');
      if (overlayEl) {
         overlayEl.remove();
      }

      if (!show) return null;

      // Create new overlay
      overlayEl = document.createElement('div');
      overlayEl.id = 'recovery-overlay';

      // Style the overlay to cover the entire screen
      overlayEl.style.position = 'fixed';
      overlayEl.style.top = '0';
      overlayEl.style.left = '0';
      overlayEl.style.width = '100%';
      overlayEl.style.height = '100%';
      overlayEl.style.backgroundColor = 'rgba(240, 240, 240, 0.5)';
      overlayEl.style.backdropFilter = 'blur(3px)';
      overlayEl.style.zIndex = '9999'; // Below the status but above everything else
      //overlayEl.style.cursor = 'not-allowed';
      overlayEl.style.display = 'flex';
      overlayEl.style.justifyContent = 'center';
      overlayEl.style.alignItems = 'center';
      overlayEl.style.transition = 'opacity 0.3s ease';

      document.body.appendChild(overlayEl);
      return overlayEl;
   }

   async recoverRenderContext() {
      return this.recoveryManager.startRecovery();
   }

   /**
    * Create resources with proper tracking
    */
   async createResources(isVideo = false) {
      if (this.imageArray.length === 0) {
         return;
      }

      // Determine if source is video
      if (typeof isVideo !== 'boolean') {
         const type = this.imageArray[this.imageIndex]?.type;
         isVideo = type === 'Video';
      }

      // Get original dimensions
      let originalWidth = isVideo ?
         this.videoProcessor.videoElement.videoWidth : this.image.width;
      let originalHeight = isVideo ?
         this.videoProcessor.videoElement.videoHeight : this.image.height;

      // Calculate scaled dimensions
      let ratio = this.ratio || 1.0;

      let scaledWidth = Math.floor(originalWidth * ratio);
      let scaledHeight = Math.floor(originalHeight * ratio);

      // Set canvas dimensions to scaled size
      this.canvas.width = scaledWidth;
      this.canvas.height = scaledHeight;

      // Initialize WebGPU context
      this.context = this.canvas.getContext('webgpu', { alpha: true });

      if (!this.context) {
         throw new Error('Failed to get WebGPU context');
      }

      if (!this.device) {
         await this.setupDevice();
      }

      try {
         // Configure context with scaled dimensions
         this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
            size: {
               width: scaledWidth,
               height: scaledHeight
            },
         });

         // Create textures with scaled dimensions
         await this.textureManager.createTextures({
            textures: this.textures,
            canvas: {
               width: scaledWidth,
               height: scaledHeight
            }
         });

         // Create a temporary canvas for scaling
         const tempCanvas = document.createElement('canvas');
         tempCanvas.width = scaledWidth;
         tempCanvas.height = scaledHeight;
         const tempCtx = tempCanvas.getContext('2d');
         tempCtx.imageSmoothingQuality = 'high';

         // Copy and scale initial frame/image
         if (isVideo) {
            // Draw the video frame onto the temporary canvas with scaling
            tempCtx.drawImage(
               this.videoProcessor.videoElement,
               0, 0,
               originalWidth, originalHeight,  // Source dimensions
               0, 0,
               scaledWidth, scaledHeight      // Destination dimensions
            );

            // Copy the scaled frame to the texture
            await this.textureManager.copyImageToTexture(
               tempCanvas,
               'texture',
               {
                  width: scaledWidth,
                  height: scaledHeight
               }
            );
         } else {
            // Handle still images
            await this.textureManager.copyImageToTexture(
               this.image,
               'texture',
               {
                  width: scaledWidth,
                  height: scaledHeight
               }
            );
         }

         // Create buffers and initialize managers
         await this.createPositionBuffer();
         await this.createTexCordBuffer();

         // Create pipelines for all filters
         for (const [, filter] of Object.entries(this.filters)) {
            filter.resources = await this.pipelineManager.createFilterPipeline(filter);
         }

         if (this.debug) {
            const cacheStats = this.pipelineManager.pipelineCacheManager.getCachePerformance();
            console.log('Pipeline Cache Performance:', cacheStats);
         }

      } catch (error) {
         console.error('Error creating resources:', error);
         throw error;
      }
   }

   /**
    * Initialize the program
    * @returns {Promise<{image: null}>}
    */
   async initialize() {
      try {

         // Validate settings before proceeding with initialization
         SettingsValidator.validateSettings(this);

         if (this.imageArray.length > 0 &&
            this.imageArray[this.imageIndex]) {
            let response = await fetch(this.imageArray[this.imageIndex].filePath);
            let blob = await response.blob();
            let url = URL.createObjectURL(blob);
            await this.loadImageSource(url);
         }

         // Setup WebGPU device
         await this.setupDevice();

         // Create initial resources
         if (this.image.width > 0) {
            await this.createResources();
         }

         // Initialize recovery manager
         this.recoveryManager = new RecoveryManager(this);

         // Initialize the filter processing manager
         this.filterManager = new FilterManager(this);

         // Create test button in debug mode
         if (this.debug) {
            this.recoveryManager.createTestButton();
         }

         this.debugLogger.log('App', 'Initialization complete');

         return true;

      }
      catch (error) {
         this.debugLogger.error('App', 'Initialization failed', error);
         throw error;
      }

   }

   /**
    * Creates or updates the recovery status element with proper styling
    * @param {string} message - Optional message to display
    * @param {string} status - Optional status (success, warning, error, recovery)
    * @param {Error|string} errorDetails - Optional error object or message for error
    * @returns {HTMLElement} The recovery status element
    */
   createRecoveryStatusElement(message = '', status = 'hidden', errorDetails = null) {
      // Remove existing element if it exists
      let statusEl = document.getElementById('recovery-status');
      if (statusEl) {
         statusEl.remove();
      }

      // Create new element
      statusEl = document.createElement('div');
      statusEl.id = 'recovery-status';

      // Base styling
      statusEl.style.position = 'fixed';
      statusEl.style.top = '50%';
      statusEl.style.left = '50%';
      statusEl.style.transform = 'translate(-50%, -50%)';
      statusEl.style.padding = '20px 30px';
      statusEl.style.borderRadius = '8px';
      statusEl.style.zIndex = '10000';
      statusEl.style.textAlign = 'center';
      statusEl.style.fontFamily = 'Arial, sans-serif';
      statusEl.style.fontSize = '24px';
      statusEl.style.transition = 'all 0.3s ease';
      statusEl.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.3)';
      statusEl.style.minWidth = '300px';

      // Status-specific styling
      if (status === 'error') {
         statusEl.style.backgroundColor = 'rgba(220, 53, 69, 0.9)';
         statusEl.style.color = '#fff';
         // Use provided message or generate default error message
         if (!message) {
            const errorMsg = errorDetails ?
               (errorDetails.message || errorDetails.toString() || 'Unknown error occurred') :
               'Unknown error occurred';

            message = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery Failed</h3>' +
               `<p>${errorMsg}</p>` +
               '<p style="margin-top: 10px;">Retrying in 5 seconds...</p>';
         }
      } else if (status === 'warning') {
         statusEl.style.backgroundColor = 'rgba(255, 193, 7, 0.9)';
         statusEl.style.color = '#212529';
         if (!message) {
            message = '<h3 style="margin: 0 0 10px 0;">WebGPU Warning</h3>' +
               '<p>Performance may be affected</p>';
         }
      } else if (status === 'success') {
         statusEl.style.backgroundColor = 'rgba(40, 167, 69, 0.9)';
         statusEl.style.color = '#fff';
         if (!message) {
            message = '<h3 style="margin: 0 0 10px 0;">Success</h3>' +
               '<p>Operation completed successfully</p>';
         }
      } else if (status === 'recovery') {
         statusEl.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
         statusEl.style.color = '#fff';
         if (!message) {
            message = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery</h3>' +
               '<p>Recovering from GPU context loss...</p>' +
               '<div style="width: 100%; height: 4px; margin-top: 15px; background: #333;">' +
               '<div id="recovery-progress" style="width: 0%; height: 100%; background: #0f6"></div></div>';
         }
      } else {
         // Hidden or default style
         statusEl.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
         statusEl.style.color = '#fff';
         statusEl.style.opacity = '0';
         statusEl.style.pointerEvents = 'none';
      }

      // Set content
      if (message) {
         statusEl.innerHTML = message;
      } else {
         statusEl.innerHTML = '<h3 style="margin: 0 0 10px 0;">WebGPU Status</h3>' +
            '<p>Ready</p>';
      }

      document.body.appendChild(statusEl);
      return statusEl;
   }




   async updateFilters(filterUpdateConditions = false) {
      if (!this.filterManager) {
         throw new Error('FilterManager not initialized');
      }
      return this.filterManager.updateFilters(filterUpdateConditions);
   }

   waitForRenderComplete() {
      if (!this.filterManager) {
         throw new Error('FilterManager not initialized');
      }
      return this.filterManager.waitForRenderComplete();
   }

   /**
   * Update the filter buffer
   * @param {string} key - The property key to update.
   * @param {number, array} value - The value to update the filters buffer with.
   * @returns {Promise<void>}
   */
   async updateFilterBuffer(key, value) {

      /**
       * Recursively searches an object for a key and returns one or more arrays of keys that make up the object path.
       * @param {Object} obj - The object to search within.
       * @param {string} keyToFind - The key to search for.
       * @returns {Array} - An array of objects that contain the key.
       */
      function findObjectsWithKey(obj, keyToFind) {
         let result = [];

         /**
          * Recursively search the object for the key
          * @param {Object} obj - The object to search within.
          * @param {Array} path - The path to the object.
          */
         function search(obj, path) {

            // If the object is not null and is an object
            if (obj && typeof obj === 'object') {
               // Check if the object has the key we are searching for
               if (obj.hasOwnProperty(keyToFind)) {
                  // If the key is found add the path to the result array
                  result.push([...path, keyToFind]);
               }
               // Loop through the object keys
               for (const key in obj) {
                  // If the object at key is not null and is an object
                  if (obj[key] && typeof obj[key] === 'object') {
                     // Recursively search the object at key
                     search(obj[key], [...path, key]);
                  }
               }
            }
         }

         search(obj, []); // Start the search

         // after searching the entire object return the arrays of paths
         return result;
      }

      const pathArray = findObjectsWithKey(this.filters, key);

      for (const path of pathArray) {
         let filter;
         let bindings = this.filters;

         for (let i = 0; i < path.length - 1; i++) {
            bindings = bindings[path[i]];
            if (i === 0) filter = bindings;
         }

         const finalKey = path[path.length - 1];
         bindings[finalKey].value = value;

         // Validate the updated filter
         try {
            SettingsValidator.validateFilters({ [filter.label]: filter });
         } catch (error) {
            console.error('Filter validation failed after update:', error);
            throw error;
         }

         // Update the buffer using the BufferManager if resources exist
         if (filter.resources?.update) {
            filter.resources.update({
               [finalKey]: { value }
            });
         }
      }
   }

   updateFilterInputTexture(filterKey, passIndex, bindingIndex, textureKey, textureIndex) {
      try {
         if (!this.filterManager) {
            throw new Error('FilterManager not initialized');
         }
         if (!this.filters[filterKey]) {
            throw new Error(`Filter ${filterKey} not found, skipping update`);
         }
         return this.filterManager.updateFilterInputTexture(
            filterKey, passIndex, bindingIndex, textureKey, textureIndex
         );
      } catch (error) {
         console.warn(`Error updating texture for ${filterKey}:`, error.message);
         return false;
      }
   }

   stopRender() {
      if (this.filterManager) {
         this.filterManager.stopRender();
      }
   }

   // NEW CODE TO IMPROVE RENDERING
   // Expose prioritized rendering methods for external use
   async urgentRender(drawToCanvas, transformations, filterUpdateConditions) {
      return this.filterManager.urgentRender(drawToCanvas, transformations, filterUpdateConditions);
   }

   async backgroundUpdate(filterUpdateConditions) {
      return this.filterManager.backgroundUpdate(filterUpdateConditions);
   }

   async updateOutputCanvas(drawToCanvas, transformations, filterUpdateConditions, priority = 'high') {
      if (!this.filterManager) {
         throw new Error('FilterManager not initialized');
      }

      // Handle different priorities
      if (priority === 'background') {
         return this.filterManager.backgroundUpdate(filterUpdateConditions);
      }
      if (priority === 'urgent') {
         return this.filterManager.urgentRender(drawToCanvas, transformations, filterUpdateConditions);
      }

      // Default to normal update
      let testValue = await this.filterManager.updateOutputCanvas(drawToCanvas, transformations, filterUpdateConditions);
      return testValue;
   }

   // Expose queue management methods
   getRenderQueueStatus() {
      return this.filterManager.renderQueue.getStatus();
   }

   cancelRenderOperations(filterType) {
      return this.filterManager.renderQueue.cancelByMetadata('filterType', filterType);
   }
}

const SequentialGPU = {
   async createApp(settings) {
      const webGpuRenderer = new WebGpuRenderer({
         ...settings,
      });
      await webGpuRenderer.initialize();
      // Return the renderer instance so it can be used by the app
      return webGpuRenderer;
   }
};

export { SequentialGPU, SequentialGPU as default };
//# sourceMappingURL=bundle.js.map
