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

class WebGPUError extends Error {
    constructor(type, message, details = null) {
        super(message);
        this.name = 'WebGPUError';
        this.type = type;
        this.details = details;
    }
}

class ErrorHandler {
    static throwError(type, message, details = null) {
        throw new WebGPUError(type, message, details);
    }

    static validateTexture(key, texture, availableTextures = []) {
        if (!texture) {
            this.throwError(
                'TextureError',
                `Texture "${key}" not found. Available textures: ${availableTextures.join(', ')}`
            );
        }
    }

    static validateFilter(filterKey, filter, passIndex = null) {
        if (!filter) {
            this.throwError(
                'FilterError',
                `Filter "${filterKey}" not found`
            );
        }

        if (passIndex !== null) {
            const pass = filter.passes[passIndex];
            if (!pass) {
                this.throwError(
                    'FilterError',
                    `Pass ${passIndex} not found in filter "${filterKey}"`
                );
            }
        }
    }

    static validateBindings(filterKey, bindings) {
        Object.entries(bindings).forEach(([bindingKey, binding]) => {
            if (!binding.type) {
                this.throwError(
                    'BindingError',
                    `Binding "${bindingKey}" in filter "${filterKey}" missing required type property`
                );
            }
            if (binding.value === undefined) {
                this.throwError(
                    'BindingError',
                    `Binding "${bindingKey}" in filter "${filterKey}" missing required value property`
                );
            }
        });
    }

    static validateBufferAttachment(filterKey, attachment) {
        if (attachment) {
            if (attachment.groupIndex === undefined) {
                this.throwError(
                    'BufferError',
                    `Filter "${filterKey}" buffer attachment missing groupIndex`
                );
            }

            if (attachment.bindingIndex !== undefined) {
                if (attachment.groupIndex === 0 &&
                    (attachment.bindingIndex === 0 || attachment.bindingIndex === 1)) {
                    this.throwError(
                        'BufferError',
                        `Invalid binding configuration in filter "${filterKey}": group index 0 and binding indices 0 and 1 are reserved`
                    );
                }
            }
        }
    }

    static async handleAsyncOperation(operation, errorMessage) {
        try {
            return await operation();
        } catch (error) {
            this.throwError(
                'OperationError',
                errorMessage,
                error
            );
        }
    }

    static wrapAsync(operation, errorMessage) {
        return async (...args) => {
            try {
                return await operation(...args);
            } catch (error) {
                this.throwError(
                    'OperationError',
                    errorMessage,
                    error
                );
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
        this.pipelineCacheManager = new PipelineCacheManager(this.device);
    }

    async loadShader(url) {
        return ErrorHandler.handleAsyncOperation(
            async () => {
                if (!this.shaderCache.has(url)) {
                    const response = await fetch(url);
                    const code = await response.text();
                    this.shaderCache.set(url, code);
                }
                return this.shaderCache.get(url);
            },
            `Failed to load shader from ${url}`
        );
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

    createBindGroupLayout(filter, pass) {
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
    }

    /*createBindGroup(layout, filter, pass, bufferResource) {
       const entries = [];

       // Add sampler
       entries.push({
          binding: 0,
          resource: this.device.createSampler({
             magFilter: 'linear',
             minFilter: 'linear'
          })
       });

       // Add texture resources
       if (pass.inputTexture && Array.isArray(pass.inputTexture)) {
          pass.inputTexture.forEach((textureName, index) => {
             const textureView = this.textureManager.getTexture(textureName)?.createView();
             if (!textureView) {
                throw new Error(`Texture ${textureName} not found`);
             }
             entries.push({
                binding: index + 1,
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

       return this.device.createBindGroup({ layout, entries });
    }
    _generateDetailedPipelineKey(config) {
       const key = JSON.stringify({
          type: config.type,
          shader: config.shaderURL,
          format: config.presentationFormat,
          samples: config.sampleCount,
          layout: config.bindGroupLayout
       });
       return this.pipelineCacheManager._hashString(key);
    }
    async createFilterPipeline(filter) {
       return ErrorHandler.handleAsyncOperation(
           async () => {


              // Create buffers if needed
              let bufferResource;
              if (filter.bufferAttachment?.bindings) {
                 bufferResource = await this.bufferManager.createFilterBuffers(filter);
              }

              for (const pass of filter.passes) {
                 const startTime = performance.now();
                 // Load and cache shader
                 const shaderCode = await this.loadShader(pass.shaderURL);
                 const shaderModule = await this.pipelineCacheManager.getShaderModule(shaderCode);

                 // Create bind group layout
                 const bindGroupLayout = this.createBindGroupLayout(filter, pass);

                 // Create pipeline layout
                 const pipelineLayout = this.device.createPipelineLayout({
                    bindGroupLayouts: [bindGroupLayout]
                 });

                 // Generate a comprehensive pipeline key
                 const pipelineKey = this._generateDetailedPipelineKey({
                    type: filter.type,
                    shaderURL: pass.shaderURL,
                    presentationFormat: this.presentationFormat,
                    sampleCount: filter.type === 'compute' ? 1 : 4,
                    bindGroupLayout: bindGroupLayout.entries
                 });

                 // Try to get cached pipeline
                 let pipeline = this.pipelineCacheManager.pipelineCache.get(pipelineKey);
                 let actualPipeline;

                 const endTime = performance.now();
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
                    this.pipelineCacheManager.stats.pipelinesCreated++;
                    this.pipelineCacheManager.stats.cacheMisses++;
                    this.pipelineCacheManager._updatePerformanceMetrics({
                       operationType: 'pipeline',
                       operation: 'create',
                       duration: endTime - startTime
                    });
                 }
                 else {
                    actualPipeline = pipeline.pipeline;
                    this.pipelineCacheManager.stats.pipelinesReused++;
                    this.pipelineCacheManager.stats.cacheHits++;
                    pipeline.metadata.lastUsed = Date.now();
                    this.pipelineCacheManager._updatePerformanceMetrics({
                       operationType: 'pipeline',
                       operation: 'reuse'
                    });
                 }

                 pass.pipeline = actualPipeline;

                 // Wait for GPU operations
                 await this.device.queue.onSubmittedWorkDone();

                 // Create bind group
                 pass.bindGroup = [this.createBindGroup(bindGroupLayout, filter, pass, bufferResource)];
              }

              // Cache maintenance
              await this._performCacheMaintenance();

              if (this.device.label?.includes('debug')) {
                 console.log('Cache Stats:', {
                    pipeline: {
                       ...this.pipelineCacheManager.stats,
                       cacheSize: this.pipelineCacheManager.pipelineCache.size
                    },
                    layout: {
                       created: this.pipelineCacheManager.stats.layoutsCreated,
                       reused: this.pipelineCacheManager.stats.layoutsReused,
                       cacheSize: this.pipelineCacheManager.layoutCache.size
                    }
                 });
              }

              console.log(this.pipelineCacheManager.stats)

              return bufferResource;
           },
           `Failed to create pipeline for filter ${filter.label}`
       );
    }*/

    ////////////////
    _generateDetailedPipelineKey(config) {
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

        //console.log(this.pipelineCacheManager.stats)

        // Generate a deterministic JSON string
        const sortedKey = JSON.stringify(keyComponents, Object.keys(keyComponents).sort());
        return this.pipelineCacheManager._hashString(sortedKey);
    }

    createBindGroup(layout, filter, pass, bufferResource) {
        /*console.log('Creating bind group:', {
           filterLabel: filter.label,
           passLabel: pass.label,
           hasLayout: !!layout,
           hasBufferResource: !!bufferResource
        });*/

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

        //console.log('Bind group entries:', entries);

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
    }

    async createFilterPipeline(filter) {
        return ErrorHandler.handleAsyncOperation(
            async () => {
                let bufferResource;
                if (filter.bufferAttachment?.bindings) {
                    bufferResource = await this.bufferManager.createFilterBuffers(filter);
                }

                for (const pass of filter.passes) {
                    const startTime = performance.now();

                    // Load and cache shader
                    const shaderCode = await this.loadShader(pass.shaderURL);
                    const shaderModule = await this.pipelineCacheManager.getShaderModule(shaderCode);

                    // Create bind group layout
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
                }

                await this._performCacheMaintenance();

                return bufferResource;
            },
            `Failed to create pipeline for filter ${filter.label}`
        );
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
                    ErrorHandler.throwError(
                        'BufferError',
                        `Binding "${key}" not found in original bindings`
                    );
                }
            }
        } catch (error) {
            ErrorHandler.throwError(
                'BufferError',
                'Failed to update buffer data',
                error
            );
        }
    }
}

class SimpleTexturePool {
    constructor(device) {
        this.device = device;
        this.availableTextures = new Map(); // descriptor hash -> texture[]
    }

    /**
     * Get a texture descriptor hash for pooling
     */
    getDescriptorHash(descriptor) {
        const key = `${descriptor.format}_${descriptor.size.width}x${descriptor.size.height}` +
            `_${descriptor.usage}_${descriptor.sampleCount}`;
        return key;
    }

    /**
     * Get a texture from the pool or create a new one
     */
    acquire(descriptor) {
        const key = this.getDescriptorHash(descriptor);
        const available = this.availableTextures.get(key) || [];

        if (available.length > 0) {
            return available.pop();
        }

        // Create new texture if none available
        return this.device.createTexture(descriptor);
    }

    /**
     * Return a texture to the pool for reuse
     */
    release(texture) {
        if (!texture.descriptor) {
            return;
        }

        const key = this.getDescriptorHash(texture.descriptor);
        const available = this.availableTextures.get(key) || [];
        available.push(texture);
        this.availableTextures.set(key, available);
    }

    /**
     * Destroy all pooled textures
     */
    destroy() {
        for (const textures of this.availableTextures.values()) {
            for (const texture of textures) {
                texture.destroy();
            }
        }
        this.availableTextures.clear();
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
        const texture = this.activeTextures.get(key);
        ErrorHandler.validateTexture(
            key,
            texture,
            Array.from(this.activeTextures.keys())
        );
        return texture;
    }

    async copyImageToTexture(image, textureKey, dimensions) {
        return ErrorHandler.handleAsyncOperation(
            async () => {
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
            },
            `Failed to copy image to texture ${textureKey}`
        );
    }

    // In your TextureManager class
    /*releaseAllTextures() {
        // Clear texture cache and release resources
        this.textureCache = {};
        this.activeTextures.clear();
        console.log('All textures released');
    }*/

    async destroyTextures() {
        // Release all active textures back to pool
        for (const [key] of this.activeTextures) {
            this.releaseTexture(key);
        }

        // Destroy the pool itself
        this.texturePool.destroy();
    }

}

class VideoProcessor {
    constructor(app) {
        this.app = app;
        this.textureManager = app.textureManager;
        this.isProcessingVideo = false;
        this.videoElement = null;
        this.frameRequestId = null;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.isVideoReady = false;
        this.lastFrameTime = 0;
        this.handleFrame = undefined;

        // FPS control properties
        this.targetFPS = 30;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastDrawTime = 0;

        // Frame properties
        this.videoDuration = 0;
        this.frameRate = 30;
        this.frameDuration = 1 / this.frameRate;
        this.frameIndex = 0;
        this.frameCount = 0;
        this.startFrame = 0;
        this.endFrame = 0;
        this.currentFrameIndex = 0;
    }

    // In the VideoProcessor class, modify copyVideoFrameToTexture
    /*async copyVideoFrameToTexture(video, textureKey, dimensions) {
        if (!video || !this.canvas || !this.ctx) {
            console.error('Required resources not available');
            return;
        }

        // Clear the canvas first
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        return new Promise((resolve) => {
            const drawFrame = () => {
                try {
                    // Update canvas dimensions if needed
                    if (this.canvas.width !== dimensions.width ||
                        this.canvas.height !== dimensions.height) {
                        this.canvas.width = dimensions.width;
                        this.canvas.height = dimensions.height;
                    }

                    // Draw the video frame
                    this.ctx.drawImage(video, 0, 0, dimensions.width, dimensions.height);

                    // Copy to texture
                    this.app.textureManager.copyImageToTexture(
                        this.canvas,
                        textureKey,
                        dimensions
                    ).then(resolve);
                } catch (error) {
                    console.error('Error in drawFrame:', error);
                    resolve(); // Resolve anyway to prevent hanging
                }
            };

            if ('requestVideoFrameCallback' in video) {
                video.requestVideoFrameCallback(() => drawFrame());
            } else {
                drawFrame(); // Fallback if requestVideoFrameCallback is not available
            }
        });
    }*/
    async copyVideoFrameToTexture(video, textureKey, dimensions) {
        if (!video || !this.canvas || !this.ctx) {
            console.error('Required resources not available');
            return;
        }

        // Update canvas dimensions to match the target dimensions
        if (this.canvas.width !== dimensions.width ||
            this.canvas.height !== dimensions.height) {
            this.canvas.width = dimensions.width;
            this.canvas.height = dimensions.height;
        }

        // Clear the canvas first
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        return new Promise((resolve) => {
            const drawFrame = () => {
                try {
                    // Enable high-quality scaling
                    this.ctx.imageSmoothingEnabled = true;
                    this.ctx.imageSmoothingQuality = 'high';

                    // Draw the video frame with scaling
                    this.ctx.drawImage(
                        video,
                        0, 0,
                        video.videoWidth, video.videoHeight,    // Source dimensions
                        0, 0,
                        dimensions.width, dimensions.height     // Destination dimensions
                    );

                    // Copy to texture
                    this.app.textureManager.copyImageToTexture(
                        this.canvas,
                        textureKey,
                        dimensions
                    ).then(resolve);
                } catch (error) {
                    console.error('Error in drawFrame:', error);
                    resolve(); // Resolve anyway to prevent hanging
                }
            };

            if ('requestVideoFrameCallback' in video) {
                video.requestVideoFrameCallback(() => drawFrame());
            } else {
                drawFrame(); // Fallback if requestVideoFrameCallback is not available
            }
        });
    }


    async seekToFrame(frameIndex) {
        if (!this.videoElement || !this.isVideoReady) return;

        const frameTime = frameIndex * this.frameDuration;
        this.videoElement.currentTime = frameTime;

        await new Promise(resolve => {
            this.videoElement.onseeked = () => {
                this.ctx.drawImage(this.videoElement, 0, 0);
                resolve();
            };
        });

        await this.app.textureManager.copyImageToTexture(
            this.canvas,
            'texture',
            {
                width: this.videoElement.videoWidth,
                height: this.videoElement.videoHeight
            }
        );

        this.currentFrameIndex = frameIndex;
        this.app.renderManager.invalidateFilterChain();
        this.app.renderManager.startRender();
    }
    // In the VideoProcessor class, modify seekToFrame
    /*async seekToFrame(frameIndex) {
        console.log(`Attempting to seek to frame ${frameIndex}`);

        if (!this.videoElement || !this.isVideoReady) {
            console.warn('Video not ready for seeking');
            return;
        }

        // Ensure frameIndex is valid and not 0
        const safeFrameIndex = Math.max(1, Math.min(frameIndex, this.frameCount - 1));
        const frameTime = safeFrameIndex * this.frameDuration;

        try {
            // Set the current time
            this.videoElement.currentTime = frameTime;

            // Wait for the seek operation to complete
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Seek timeout')), 1000);

                const onSeeked = () => {
                    clearTimeout(timeout);
                    this.videoElement.removeEventListener('seeked', onSeeked);
                    resolve();
                };

                this.videoElement.addEventListener('seeked', onSeeked);
            });

            // Wait for a new frame and copy it
            await new Promise(resolve => {
                this.videoElement.requestVideoFrameCallback(async () => {
                    // Clear canvas and draw new frame
                    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    this.ctx.drawImage(this.videoElement, 0, 0);

                    // Copy frame to texture using actual video dimensions
                    await this.app.textureManager.copyImageToTexture(
                        this.canvas,
                        'texture',
                        {
                            width: this.canvas.width,
                            height: this.canvas.height
                        }
                    );

                    this.currentFrameIndex = safeFrameIndex;

                    // Force a new render
                    if (this.app.renderManager) {
                        this.app.renderManager.invalidateFilterChain();
                        this.app.renderManager.startRender();
                    }

                    resolve();
                });
            });

            console.log(`Successfully seeked to frame ${safeFrameIndex}`);

        } catch (error) {
            console.error('Error in seekToFrame:', error);
            // If seek fails, try next frame
            if (safeFrameIndex < this.frameCount - 1) {
                console.log('Attempting recovery by seeking to next frame');
                await this.seekToFrame(safeFrameIndex + 1);
            }
        }
    }*/

    setFrameRange(start, end) {
        let seekFrame = this.startFrame !== start ? this.startFrame : this.endFrame;
        this.startFrame = Math.max(0, Math.min(start, this.frameCount - 1));
        this.endFrame = Math.max(0, Math.min(end, this.frameCount));

        if (!this.isProcessingVideo) {
            this.seekToFrame(seekFrame);
        } else if (this.currentFrameIndex < this.startFrame || this.currentFrameIndex > this.endFrame) {
            this.currentFrameIndex = this.startFrame;
            this.seekToFrame(seekFrame);
        }
    }

    setFPS(fps) {
        this.targetFPS = Math.max(1, Math.min(60, fps));
        this.frameInterval = 1000 / this.targetFPS;
    }

    async loadVideo(videoUrl) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.crossOrigin = "anonymous";
            video.autoplay = false;
            video.muted = true;
            video.loop = true;

            const getFrameCount = async (video) => {
                return new Promise((resolve) => {
                    const checkFrames = async () => {
                        let frameCount = 0;

                        try {
                            if ('requestVideoFrameCallback' in video) {
                                let frameCounter = 0;
                                let lastTime = 0;
                                let knownFrameTimes = new Set();

                                const countFrames = new Promise((resolveCount) => {
                                    const countFrame = (now, metadata) => {
                                        const currentTime = metadata.mediaTime;

                                        if (currentTime < lastTime && currentTime < 0.1) {
                                            resolveCount(knownFrameTimes.size);
                                            return;
                                        }

                                        if (!knownFrameTimes.has(currentTime)) {
                                            frameCounter++;
                                            knownFrameTimes.add(currentTime);
                                        }

                                        lastTime = currentTime;
                                        video.requestVideoFrameCallback(countFrame);
                                    };
                                    video.requestVideoFrameCallback(countFrame);
                                });

                                const wasLooping = video.loop;
                                const wasPlaying = !video.paused;
                                const originalPlaybackRate = video.playbackRate;
                                const originalCurrentTime = video.currentTime;

                                video.muted = true;
                                video.loop = true;
                                video.currentTime = 0;
                                video.playbackRate = 1.0;
                                await video.play();

                                frameCount = await countFrames;

                                video.pause();
                                video.currentTime = originalCurrentTime;
                                video.loop = wasLooping;
                                video.playbackRate = originalPlaybackRate;
                                if (!wasPlaying) {
                                    video.pause();
                                }

                                if (frameCount > 0) {
                                    return frameCount;
                                }
                            }
                        } catch (error) {
                            console.warn('Frame counting with requestVideoFrameCallback failed:', error);
                        }
                    };

                    if (video.duration === Infinity || video.duration === 0) {
                        video.addEventListener('durationchange', async () => {
                            const frames = await checkFrames();
                            resolve(frames);
                        }, { once: true });
                    } else {
                        checkFrames().then(resolve);
                    }
                });
            };

            video.addEventListener('loadedmetadata', async () => {
                try {
                    this.videoDuration = video.duration;
                    this.frameCount = Math.floor(this.videoDuration * this.frameRate);
                    this.frameDuration = 1 / this.frameRate;

                    const frameCount = await getFrameCount(video);

                    if (frameCount > 0 && Math.abs(frameCount - this.frameCount) > 5) {
                        this.frameRate = Math.round(frameCount / video.duration) || 30;
                        this.frameDuration = 1 / this.frameRate;
                        this.frameCount = frameCount || Math.floor(video.duration * this.frameRate);
                    }

                    this.startFrame = 0;
                    this.endFrame = this.frameCount - 1;
                    this.currentFrameIndex = this.startFrame;

                    window.dispatchEvent(new CustomEvent('frameCountUpdated', {
                        detail: { frameCount: this.frameCount }
                    }));
                } catch (error) {
                    console.warn('Error calculating frame count:', error);
                    this.frameRate = 30;
                    this.frameDuration = 1 / this.frameRate;
                    this.frameCount = Math.floor(video.duration * this.frameRate);
                }
            });

            video.addEventListener('canplay', async () => {
                this.isVideoReady = true;
                if (!this.videoElement) {
                    this.videoElement = video;
                    this.canvas.width = video.videoWidth;
                    this.canvas.height = video.videoHeight;
                    await this.app.createResources(true);
                    resolve(video);
                }
            });

            video.onerror = reject;
            video.src = videoUrl;
            video.load();
        });
    }

    /*async startProcessing() {
        if (!this.isVideoReady || !this.videoElement || this.isProcessingVideo) {
            console.warn('Video not ready or already processing');
            return;
        }

        this.app.updateManager.setAnimating(true);
        this.isProcessingVideo = true;
        this.lastDrawTime = performance.now();
        this.videoElement.pause();

        this.currentFrameIndex = this.startFrame;
        this.videoElement.currentTime = this.currentFrameIndex * this.frameDuration;

        const processFrame = async (timestamp) => {
            if (!this.isProcessingVideo) return;

            if (timestamp - this.lastDrawTime >= this.frameInterval) {
                try {
                    const nextFrameTime = Math.min(
                        this.currentFrameIndex * this.frameDuration,
                        this.videoElement.duration - 0.001
                    );

                    if (isFinite(nextFrameTime) && nextFrameTime >= 0) {
                        this.videoElement.currentTime = nextFrameTime;

                        await new Promise(resolve => {
                            this.videoElement.onseeked = () => {
                                this.ctx.drawImage(this.videoElement, 0, 0);
                                resolve();
                            };
                        });

                        await this.app.textureManager.copyImageToTexture(
                            this.canvas,
                            'texture',
                            {
                                width: this.videoElement.videoWidth,
                                height: this.videoElement.videoHeight
                            }
                        );

                        this.currentFrameIndex++;
                        if (this.currentFrameIndex > this.endFrame) {
                            this.currentFrameIndex = this.startFrame;
                        }

                        this.app.renderManager.invalidateFilterChain();
                        this.app.renderManager.startRender();

                        this.lastDrawTime = timestamp;
                        this.lastFrameTime = nextFrameTime;
                    }
                } catch (error) {
                    console.error('Error processing frame:', error);
                }
            }

            this.frameRequestId = requestAnimationFrame(processFrame);
        };

        this.frameRequestId = requestAnimationFrame(processFrame);
    }*/
    async startProcessing() {
        if (!this.isVideoReady || !this.videoElement || this.isProcessingVideo) {
            console.warn('Video not ready or already processing');
            return;
        }

        this.app.updateManager.setAnimating(true);
        this.isProcessingVideo = true;
        this.lastDrawTime = performance.now();
        this.videoElement.pause();

        const processFrame = async (timestamp) => {
            if (!this.isProcessingVideo) return;

            if (timestamp - this.lastDrawTime >= this.frameInterval) {
                try {
                    // Only update the frame if we're not in the middle of filter processing
                    if (!this.app.renderManager.isProcessingFilters) {
                        const nextFrameTime = Math.min(
                            this.currentFrameIndex * this.frameDuration,
                            this.videoElement.duration - 0.001
                        );

                        if (isFinite(nextFrameTime) && nextFrameTime >= 0) {
                            this.videoElement.currentTime = nextFrameTime;

                            await new Promise(resolve => {
                                this.videoElement.onseeked = () => {
                                    this.ctx.drawImage(this.videoElement, 0, 0);
                                    resolve();
                                };
                            });

                            await this.app.textureManager.copyImageToTexture(
                                this.canvas,
                                'texture',
                                {
                                    width: this.videoElement.videoWidth,
                                    height: this.videoElement.videoHeight
                                }
                            );

                            this.currentFrameIndex++;
                            if (this.currentFrameIndex > this.endFrame) {
                                this.currentFrameIndex = this.startFrame;
                            }
                        }
                    }

                    // Always process filters on the current frame
                    this.app.renderManager.invalidateFilterChain();
                    this.app.renderManager.startRender();

                    this.lastDrawTime = timestamp;
                } catch (error) {
                    console.error('Error processing frame:', error);
                }
            }

            this.frameRequestId = requestAnimationFrame(processFrame);
        };

        this.frameRequestId = requestAnimationFrame(processFrame);
    }

    stopProcessing() {
        this.app.updateManager.setAnimating(false);
        this.isProcessingVideo = false;
        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.currentTime = this.startFrame * this.frameDuration;
        }
        if (this.frameRequestId !== null) {
            cancelAnimationFrame(this.frameRequestId);
            this.frameRequestId = null;
        }
        this.lastFrameTime = 0;
        this.lastDrawTime = 0;
        this.currentFrameIndex = this.startFrame;
    }

    dispose() {
        this.stopProcessing();

        if (this.frameRequestId) {
            cancelAnimationFrame(this.frameRequestId);
            this.frameRequestId = null;
        }

        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.src = '';
            this.videoElement.load();
            this.videoElement.remove();
            this.videoElement = null;
        }

        if (this.canvas) {
            this.ctx = null;
            this.canvas.width = 1;
            this.canvas.height = 1;
            this.canvas = null;
        }

        this.isVideoReady = false;
        this.lastFrameTime = 0;
        this.frameIndex = 0;
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
            resource: this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear'
            })
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

    createDynamicBindGroupEntries(filter, pass) {
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
    }

    createDynamicBindGroup(layout, filter, pass, bufferResource) {
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
                    ErrorHandler.validateTexture(textureName, textureView);
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
            ErrorHandler.throwError(
                'BindGroupError',
                `Failed to create bind group for filter ${filter.label}`,
                error
            );
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

    _generateLayoutKey(filter, pass) {
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
    }

    async updateFilterInputTexture(filterKey, passIndex, bindingIndex, textureKey, textureIndex, filters) {
        const filter = filters[filterKey];
        ErrorHandler.validateFilter(filterKey, filter, passIndex);

        if (!filter) {
            console.error(`Filter "${filterKey}" not found`);
            return;
        }

        const pass = filter.passes[passIndex];
        if (!pass) {
            console.error(`Pass ${passIndex} not found in filter "${filterKey}"`);
            return;
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

    // In your BindingManager class
    /*clearBindingCache() {
        // Reset binding caches
        this.bindGroups = {};
        this.bindGroupLayouts = {};
        console.log('Binding cache cleared');
    }*/

}

class UpdateManager {
    constructor(app) {
        this.app = app;
        this.isProcessingUpdates = false;
        this.pendingUpdates = [];
        this.updateInterval = null;
        this.batchTimeoutId = null;
        this.maxBatchDelay = 16; // ms to wait before processing updates
        this.isAnimating = false;
    }

    queueUpdate(updateFn, immediate = false) {

        // Add debug logging if enabled
        if (this.app.debug) {
            console.log('Queueing update, immediate:', immediate);
        }

        // Create a promise that resolves when the update is complete
        return new Promise((resolve, reject) => {
            const wrappedUpdate = async () => {
                try {
                    // Skip if updateFn is undefined
                    if (typeof updateFn === 'function') {
                        await updateFn();
                    }
                    if (this.app.debug) {
                        console.log('Update completed successfully');
                    }
                    resolve();
                } catch (error) {
                    console.error('Error in update:', error);
                    reject(error);
                }
            };

            if (immediate) {
                // If immediate, process right away
                this._processUpdate(wrappedUpdate);
            } else {
                // Otherwise add to queue
                this.pendingUpdates.push(wrappedUpdate);
                this._scheduleBatchUpdate();
            }
        });
    }

    async _processUpdate(updateFn) {
        
        if (this.isProcessingUpdates) {
            console.log('Already processing, queueing update');  // Add this line
            // If already processing, add to queue
            this.pendingUpdates.push(updateFn);
            return;
        }

        try {
            this.isProcessingUpdates = true;
            // Skip if updateFn is undefined
            if (typeof updateFn === 'function') {
                await updateFn();
            }
            
            // Trigger render pipeline update if needed
            if (!this.isAnimating) {
                this.app.renderManager.startRender();
            }
        } catch (error) {
            console.error('Error processing update:', error);
            throw error;
        } finally {
            this.isProcessingUpdates = false;
        }
    }

    async _processBatch() {
        if (this.pendingUpdates.length === 0) return;

        // Filter out any undefined functions
        const updates = this.pendingUpdates.filter(update => typeof update === 'function');
        this.pendingUpdates = [];

        if (updates.length === 0) return;

        try {
            this.isProcessingUpdates = true;

            for (const update of updates) {
                await update();
            }

            // Trigger render pipeline update if needed
            if (!this.isAnimating) {
                this.app.renderManager.invalidateFilterChain(['threshold']);
                this.app.renderManager.startRender();
            }
        } catch (error) {
            console.error('Error processing batch:', error);
            throw error;
        } finally {
            this.isProcessingUpdates = false;
        }
    }

    _scheduleBatchUpdate() {
        // Clear existing timeout
        if (this.batchTimeoutId) {
            clearTimeout(this.batchTimeoutId);
        }

        // Schedule new batch update
        this.batchTimeoutId = setTimeout(() => {
            this._processBatch();
        }, this.maxBatchDelay);
    }

    setAnimating(isAnimating) {
        this.isAnimating = isAnimating;
    }

    dispose() {
        if (this.batchTimeoutId) {
            clearTimeout(this.batchTimeoutId);
        }
        this.pendingUpdates = [];
        this.isProcessingUpdates = false;
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
        return ErrorHandler.handleAsyncOperation(
            async () => {
                if (!this.isRecording || this.pendingCommands.length === 0) {
                    return Promise.resolve();
                }

                const commandBuffer = this.activeEncoder.finish();
                this.device.queue.submit([commandBuffer]);

                this.pendingCommands = [];
                this.activeEncoder = null;
                this.isRecording = false;

                return this.device.queue.onSubmittedWorkDone();
            },
            'Failed to flush command queue'
        );
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
            ErrorHandler.throwError(
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

class App {
   constructor(settings) {

      //// ESSENTIAL SETTINGS BELOW ////
      this.imageIndex = settings.imageIndex;
      this.imageArray = settings.imageArray;

      this.textures = settings.textures; // Store the textures parameter as a class property
      this.textures.texture = {
         copyImageTo: true,
         label: 'texture',
         notes: 'this is the texture that will be used to copy the image to. For the filters initial input. DO NOT WRITE OVER IT',
      };
      this.textures.textureMASS = {
         label: 'textureMASS',
         notes: 'This is the texture that will be used by the colorAttachments in the renderPass for Multi Sampling',
         usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
         sampleCount: 4,
      };
      this.textures.textureTemp = {
         label: 'textureTemp',
         notes: 'This is the texture that will be used to temporarily store the output of the filters. It will then be used for be copying back to the input texture',
      };

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
      this.commandQueue = null; // Will be initialized after device setup
      this.videoProcessor = null; // Will be initialized after device setup

      this.canvas = document.createElement('canvas');
      this.canvas.width = 800;
      this.canvas.height = 800;
      this.canvas.id = 'webgpu-canvas';
      this.canvas.style.display = 'none';
      this.context = undefined;

      // Add context lost/restored handlers
      //this.canvas.addEventListener('webglcontextlost', this._handleContextLost.bind(this), false);
      //this.canvas.addEventListener('webglcontextrestored', this._handleContextRestored.bind(this), false);

      // Add canvas to document if needed
      //document.body.appendChild(this.canvas);

      this.updateManager = new UpdateManager(this);
      this.presentationFormat = settings.presentationFormat || navigator.gpu.getPreferredCanvasFormat(); // Default format

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





      // Add these to your main app initialization
      window.addEventListener('beforeunload', async (event) => {
         // Ensure cleanup happens before unload
         if (this) {
            await this.dispose();
         }
      });

      //// DEBUG ////
      // Only enable in development/debug mode
      this.debugLogger = new DebugLogger(settings.debug);
      // Example debug log
      if (settings.debug) {
         this.debugLogger.log('App', 'Initializing with settings:', settings);
      }
      // Modify the monitoring interval
      if (settings.debug) {
         this.monitoringInterval = setInterval(() => {
            this.debugLogger.log('Performance', 'Current Stats', {
               pipelineCache: this.pipelineManager?.getCacheStats(),
               commandQueue: this.commandQueue?.stats
            });
         }, 10000);
      }
   }


   async recoverRenderContext() {
      console.log('Attempting to recover render context');
      try {
         await this.dispose();
         await this.setupDevice();
         await this.createResources(this.imageArray[this.imageIndex].type === 'Video');

         if (this.renderManager) {
            this.renderManager.startRender();
         }
      } catch (error) {
         console.error('Failed to recover render context:', error);
      }
   }


   async _cleanup() {
      try {
         // Prevent multiple cleanup attempts
         if (this.isDisposed) {
            return;
         }

         // Stop monitoring and intervals
         if (this.cacheMonitorInterval) {
            clearInterval(this.cacheMonitorInterval);
         }

         // Dispose of resources
         await this.dispose();

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
         // Stop video processing first
         if (this.videoProcessor) {
            this.videoProcessor.dispose();
            this.videoProcessor = null;
         }

         // Stop render manager
         if (this.renderManager) {
            this.renderManager.cleanup();
            this.renderManager = null;
         }

         // Clear command queue
         if (this.commandQueue) {
            await this.commandQueue.flush();
            this.commandQueue.dispose();
         }

         // Wait for GPU operations
         await this.waitForGPU();

         // Clean up managers in order
         if (this.textureManager) {
            await this.textureManager.destroyTextures();
         }

         await this.cleanupResources('bindGroups');
         await this.cleanupResources('pipelines');
         await this.cleanupResources('textures');
         await this.cleanupResources('buffers');

         // Clean up buffers
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

         if (this.pipelineManager) {
            this.pipelineManager.dispose();
         }

         // Clear all managers
         this.textureManager = null;
         this.bufferManager = null;
         this.pipelineManager = null;
         this.bindingManager = null;

         this.isDisposed = true;

         // Remove event listeners
         window.removeEventListener('beforeunload', this._cleanup.bind(this));
         document.removeEventListener('visibilitychange', this._cleanup.bind(this));

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

   /**
    * Reset the application state and resources
    */
   async reset() {
      try {
         // Dispose of current resources
         await this.dispose();

         // Reinitialize
         await this.setupDevice();
         await this.createResources();

         this.isDisposed = false;
      } catch (error) {
         console.error('Error resetting app:', error);
         throw error;
      }
   }

   async loadImageSource(blob) {
      return ErrorHandler.handleAsyncOperation(
         async () => {
            let imageURL = blob;

            // Create image and load it
            const img = new Image();

            return new Promise((resolve, reject) => {
               img.onload = () => {
                  this.image = img;

                  // Only revoke the URL AFTER the image has loaded successfully
                  // And only if we created a new blob URL (not for string paths)
                  if (imageURL !== blob && (blob instanceof Blob ||
                     (typeof blob === 'object'))) {
                     console.log("******  !!!!  REVOKE URL  !!!!  ******");
                     URL.revokeObjectURL(imageURL);
                  }

                  resolve(img);
               };

               img.onerror = (error) => reject(error);
               img.src = imageURL;
            });
         },
         `Failed to load image URL ${blob}`
      );
   }


   // Add this method to App class
   async initVideoProcessor() {
      if (!this.videoProcessor) {
         this.videoProcessor = new VideoProcessor(this);
      }
   }

   /**
    * Resize with proper resource cleanup
    */
   async resize(width, height, resetSize = false) {
      return ErrorHandler.handleAsyncOperation(
         async () => {
            console.log('Starting resize operation');
            console.log(`Width: ${width}, Height: ${height}, ResetSize: ${resetSize}`);

            // Wait for GPU to complete pending work
            await this.waitForGPU();
            console.log('GPU work completed');

            // Check if video processor exists and if current file is video
            let type = this.imageArray[this.imageIndex].type;
            let isVideo = type === 'Video';
            console.log("IS VIDEO", isVideo);

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
            console.log(`Ratio set to: ${this.ratio}`);

            // Store cache state before resizing
            if (this.pipelineManager) {
               const pipelineCacheState = this.pipelineManager.pipelineCacheManager.storeCacheState();

               // Release all active textures back to the pool
               const activeTextureKeys = Array.from(this.textureManager.activeTextures.keys());
               for (const key of activeTextureKeys) {
                  this.textureManager.releaseTexture(key);
               }
               console.log('Active textures released');

               // Recreate resources
               await this.createResources(isVideo);
               console.log('Resources recreated');

               // Restore compatible cached items with new dimensions
               await this.pipelineManager.pipelineCacheManager.restoreCacheState(
                  pipelineCacheState,
                  {
                     width: this.canvas.width,
                     height: this.canvas.height
                  }
               );
               console.log('Cache state restored');
            }
            else {
               // If no pipeline manager exists, just create resources
               await this.createResources(isVideo);
            }

            return true;
         },
         'Failed to resize application'
      );
   }

   //// DO NOT DELETE SCALE FUNCTION ////
   /*async scale(ratio) {
      try {
         // Destroy existing textures

         await this.textureManager.destroyTextures();

         this.ratio = ratio;


         console.log(this.imageArray[this.imageIndex])
         let type = this.imageArray[this.imageIndex].type;
         let isVideo = type === 'Video';
         // Recreate resources
         await this.createResources(isVideo);
         return true;
      } catch (error) {
         console.error('Error resizing textures', error);
      }
   }*/
   /*async scale(ratio) {
      try {
         // Wait for any pending GPU operations
         await this.waitForGPU();

         // Store the new ratio
         this.ratio = ratio;

         // Calculate new dimensions
         const newWidth = Math.floor(this.image.width * ratio);
         const newHeight = Math.floor(this.image.height * ratio);

         // Update canvas dimensions
         this.canvas.width = newWidth;
         this.canvas.height = newHeight;

         // Reconfigure the context with new dimensions
         this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
            size: {
               width: newWidth,
               height: newHeight
            },
         });

         // Release existing textures
         await this.textureManager.destroyTextures();

         // Get file type to check if it's a video
         let type = this.imageArray[this.imageIndex].type;
         let isVideo = type === 'Video';

         // Recreate resources with new dimensions
         await this.createResources(isVideo);

         return true;
      } catch (error) {
         console.error('Error scaling textures:', error);
         throw error;
      }
   }*/

   async clearBuffer(buffer) {
      // Create a temporary buffer to clear the buffer
      const tempBuffer = this.device.createBuffer({
         size: buffer.size,
         usage: GPUBufferUsage.COPY_SRC,
         mappedAtCreation: true
      });

      // Fill the temporary buffer with zeros
      new Uint8Array(tempBuffer.getMappedRange()).fill(0);
      tempBuffer.unmap();

      // Create a command encoder
      const commandEncoder = this.device.createCommandEncoder();

      // Copy the temporary buffer to the buffer to clear it
      commandEncoder.copyBufferToBuffer(tempBuffer, 0, buffer, 0, buffer.size);

      // Submit the commands
      const commandBuffer = commandEncoder.finish();
      this.device.queue.submit([commandBuffer]);
   }

   /**
    * Reads the histogram values from the GPU buffer.
    * @returns {Promise<number[]>} Array of histogram values
    * @throws {Error} If histogram buffer is not initialized
    */
   async readHistogramValues() {
      // Get histogram filter and validate

      const histogramFilter = this.filters.histogramCompute;
      if (!histogramFilter?.resources?.buffer) {
         throw new Error('Histogram buffer not initialized');
      }

      // Create buffer for reading data
      const readBackBuffer = this.device.createBuffer({
         size: 256 * Float32Array.BYTES_PER_ELEMENT, // 256 bins * 4 bytes per value
         usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
         label: 'Histogram ReadBack Buffer'
      });

      try {
         // Create and execute command encoder
         const commandEncoder = this.device.createCommandEncoder({
            label: 'Read Histogram Values'
         });

         const sourceBuffer = histogramFilter.resources.buffers?.histogram ||
            histogramFilter.resources.buffer;

         commandEncoder.copyBufferToBuffer(
            sourceBuffer,
            0,
            readBackBuffer,
            0,
            256 * Float32Array.BYTES_PER_ELEMENT
         );

         this.device.queue.submit([commandEncoder.finish()]);

         // Map and read the data
         await readBackBuffer.mapAsync(GPUMapMode.READ);
         const mappedRange = readBackBuffer.getMappedRange();
         const histogramData = new Uint32Array(mappedRange);

         // Copy the data to a regular array
         const histogram = Array.from(histogramData);

         // Cleanup
         readBackBuffer.unmap();

         // Clear the combinedBuffer after using it
         //await this.clearBuffer(sourceBuffer);

         return histogram;
      } finally {
         // Optional: destroy the readback buffer if it won't be reused
         readBackBuffer.destroy();
      }
   }

   /**
    * Reads and analyzes histogram data from the GPU
    * @returns {Promise<Object>} Histogram statistics
    */
   async readAndAnalyzeHistogram() {
      try {
         // Get histogram filter and validate
         const histogramFilter = this.filters.histogramCompute;
         if (!histogramFilter?.resources?.buffer) {
            throw new Error('Histogram buffer not initialized');
         }

         // Read raw histogram data
         const histogramData = await this.readHistogramValues();

         // Validate histogram data
         if (!histogramData || histogramData.length === 0) {
            console.warn('No histogram data received');
            return null;
         }

         // Calculate statistics
         const stats = Histogram.calculateStatistics(histogramData);

         // Add raw data to stats for debugging
         stats.rawHistogram = histogramData;

         // Log statistics
         if (this.debug) {
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

      // Create tracked buffer
      this.positionBuffer = this.createTrackedBuffer({
         size: 24,
         usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.positionBuffer, 0, new Float32Array([
         -1, -1,
         3, -1,
         -1, 3
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
      this.device.queue.writeBuffer(this.texCordBuffer, 0, new Float32Array([
         0, 1,
         2, 1,
         0, -1
      ]));
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

   /**
    * Update the resource texture in the bindGroupArray for a specific filter.
    * @param {string} filterKey - The key of the filter to update.
    * @param {number} passIndex - The pass index to update.
    * @param {number} bindingIndex - The binding index to update.
    * @param {string|array} textureKey - The texture key or array to update.
    * @param {number} textureIndex - The index of the texture to update.
    */
   updateFilterInputTexture(filterKey, passIndex, bindingIndex, textureKey, textureIndex) {
      this.bindingManager.updateFilterInputTexture(
         filterKey,
         passIndex,
         bindingIndex,
         textureKey,
         textureIndex,
         this.filters
      );
   }

   /**
    * Execute the filter for the given pass
    * @param {object} pass - The pass object to execute.
    * @param {string} type - The type of pass to execute.
    * @returns {Promise<boolean>}
    */
   async executeFilterPass(pass, type) {

      if (!pass.bindGroup) {
         console.error('Pass bindGroup is missing:', pass.label);
         return false;
      }

      if (!pass.bindGroup[0]) {
         console.error('Pass bindGroup[0] is missing:', pass.label);
         return false;
      }

      const bindGroupArray = this.bindingManager.getBindGroupArray();
      if (!bindGroupArray[0]) {
         console.error('BindGroupArray[0] is missing');
         return false;
      }
      /////////
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
         this.textureManager.debugTextures();
      }

      // You would access it through the binding manager
      //const bindGroupArray = this.bindingManager.getBindGroupArray();

      if (!pass.bindGroup || !bindGroupArray[0]) {
         console.error('No bind group available for pass:', pass.label);
         return false;
      }

      const { outputTexture, pipeline } = pass;
      this.device.createCommandEncoder({
         label: `Encoder for ${pass.label}`
      });

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

         this.commandQueue.addComputePass({
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
         // If we're writing to the same texture we're reading from, use a temporary texture
         const shouldUseTemp = pass.inputTexture.includes(outputTexture);
         const finalOutputTexture = shouldUseTemp ? 'textureTemp' : outputTexture;

         // Debug texture selection
         if (pass.label.includes('debug')) {
            console.log('Should use temp:', shouldUseTemp);
            console.log('Final output texture:', finalOutputTexture);
         }

         this.commandQueue.addRenderPass({
            label: `Render pass for ${pass.label}`,
            descriptor: {
               colorAttachments: [{
                  view: this.textureManager.getTexture('textureMASS').createView(),
                  resolveTarget: finalOutputTexture ?
                     this.textureManager.getTexture(finalOutputTexture).createView() :
                     this.context.getCurrentTexture().createView(),
                  loadOp: 'clear',
                  storeOp: 'store',
                  clearValue: [0, 0, 0, 0]
               }]
            },
            commands: (renderPass) => {
               renderPass.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
               renderPass.setPipeline(pipeline);
               renderPass.setBindGroup(0, pass.bindGroup[0]);
               renderPass.setVertexBuffer(0, this.positionBuffer);
               renderPass.setVertexBuffer(1, this.texCordBuffer);
               renderPass.draw(3);
            }
         });

         // If we used a temporary texture, copy it to the final destination
         if (shouldUseTemp && outputTexture) {
            this.commandQueue.addTextureCopy({
               label: `Copy temp to ${outputTexture}`,
               source: { texture: this.textureManager.getTexture('textureTemp') },
               destination: { texture: this.textureManager.getTexture(outputTexture) },
               copySize: {
                  width: this.canvas.width,
                  height: this.canvas.height,
                  depthOrArrayLayers: 1
               }
            });
         }

         // Flush commands if this is the final pass
         if (outputTexture === undefined) {
            await this.commandQueue.flush();
            return true;
         }

         return false;
      }
   }

   async renderFilterPasses(filter) {
      let breakLoop = false;
      // loop through the passes
      for (const pass of filter.passes) {
         if (pass.active) {
            breakLoop = await this.executeFilterPass(pass, filter.type);
         }
         if (breakLoop) {
            break;
         }
      }
      return breakLoop;
   }

   /**
    * Set up the device, context, and canvas
    * @returns {Promise<void>}
    */
   async setupDevice() {
      try {
         //this.adapter = await navigator.gpu.requestAdapter();
         //this.device = await this.adapter.requestDevice();

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

         // Set up uncaptured error handler for early detection of context issues
         this.device.addEventListener('uncapturederror', (event) => {
            console.error('WebGPU device error:', event.error);

            // If this is a device lost error, trigger recovery
            if (event.error.constructor.name === 'GPUDeviceLostInfo') {
               console.warn('Device explicitly reported as lost, initiating recovery');
               this.recoverRenderContext();
            }
         });

         if (this.imageArray[this.imageIndex]) {
            let name = this.imageArray[this.imageIndex].name;
            this.adapter.label = name;
            this.device.label = name;
         }

         this.textureManager = new TextureManager(this);

         this.bindingManager = new BindingManager(this);
      }
      catch (error) {
         console.error(`Failed to setup device: ${error}`);
      }
   }

   /**
    * Create resources with proper tracking
    */
   /*async createResources(isVideo = false) {

      console.log(this.imageArray);
      if(this.imageArray.length === 0){
         return;
      }
      let type = this.imageArray[this.imageIndex].type;
      console.log(type);

      isVideo = type === 'Video';


      let width = isVideo ? this.videoProcessor.videoElement.videoWidth : this.image.width;
      let height = isVideo ? this.videoProcessor.videoElement.videoHeight : this.image.height;

      let ratio = this.ratio || 1.0;
      this.canvas.width = width * ratio;
      this.canvas.height = height * ratio;


      try {
         this.context = this.canvas.getContext('webgpu', { alpha: true });
      } catch (error) {
         console.error('Error initializing WebGPU context:', error);
         throw error;
      }

      if (!this.device) {
         await this.setupDevice();
      }

      try {
         this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
            size: {
               width: this.canvas.width,
               height: this.canvas.height
            },
         });

         // Create textures and track them
         await this.textureManager.createTextures({
            textures: this.textures,
            canvas: {
               width: this.canvas.width,
               height: this.canvas.height
            }
         });

         console.log(isVideo);
         // Copy initial frame/image
         if (isVideo) {
            await this.textureManager.copyVideoFrameToTexture(
                this.videoProcessor.videoElement,
                'texture',
                {
                   width: width,
                   height: height
                }
            );
         } else {
            await this.textureManager.copyImageToTexture(
                this.image,
                'texture',
                {
                   width: width,
                   height: height
                }
            );
         }

         // Create buffers
         await this.createPositionBuffer();
         await this.createTexCordBuffer();

         // Initialize managers if needed
         if (!this.bufferManager) {
            this.bufferManager = new BufferManager(this.device);
         }
         if (!this.pipelineManager) {
            this.pipelineManager = new PipelineManager(this);
         }
         if(!this.commandQueue){
            this.commandQueue = new CommandQueueManager(this.device);
         }

         // Create pipelines for all filters
         for (const [filterName, filter] of Object.entries(this.filters)) {
            filter.resources = await this.pipelineManager.createFilterPipeline(filter);
         }
         // Add debug logging after pipelines are created
         if (this.debug) {
            const cacheStats = this.pipelineManager.pipelineCacheManager.getCachePerformance();
            console.log('Pipeline Cache Performance:', cacheStats);
         }

      } catch (error) {
         console.error('Error creating resources:', error);
         throw error;
      }
   }*/
   /*async createResources(isVideo = false) {
      if (this.imageArray.length === 0) {
         return;
      }

      let type = this.imageArray[this.imageIndex].type;
      isVideo = type === 'Video';

      // Get original dimensions
      let originalWidth = isVideo ? this.videoProcessor.videoElement.videoWidth : this.image.width;
      let originalHeight = isVideo ? this.videoProcessor.videoElement.videoHeight : this.image.height;


      // Calculate scaled dimensions
      //let ratio = this.ratio || 1.0;
      let ratio = 0.416 || 1.0;
      let scaledWidth = Math.floor(originalWidth * ratio);
      let scaledHeight = Math.floor(originalHeight * ratio);

      console.log(originalWidth, originalHeight, scaledWidth, scaledHeight);
      // Set canvas dimensions to scaled size
      this.canvas.width = scaledWidth;
      this.canvas.height = scaledHeight;

      try {
         this.context = this.canvas.getContext('webgpu', { alpha: true });
      } catch (error) {
         console.error('Error initializing WebGPU context:', error);
         throw error;
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

         console.log(`GOT FILTERS`);
         // Copy initial frame/image using scaled dimensions
         if (isVideo) {
            await this.textureManager.copyVideoFrameToTexture(
                this.videoProcessor.videoElement,
                'texture',
                {
                   width: scaledWidth,
                   height: scaledHeight
                }
            );
         }
         else {
            await this.textureManager.copyImageToTexture(
                this.image,
                'texture',
                {
                   width: scaledWidth,
                   height: scaledHeight
                }
            );
         }
         // In the createResources method, replace the video handling section with this:


         // Create buffers and initialize managers
         await this.createPositionBuffer();
         await this.createTexCordBuffer();

         if (!this.bufferManager) {
            this.bufferManager = new BufferManager(this.device);
         }
         if (!this.pipelineManager) {
            this.pipelineManager = new PipelineManager(this);
         }
         if (!this.commandQueue) {
            this.commandQueue = new CommandQueueManager(this.device);
         }

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
   }*/
   async createResources(isVideo = false) {
      if (this.imageArray.length === 0) {
         return;
      }

      let type = this.imageArray[this.imageIndex].type;
      isVideo = type === 'Video';

      // Get original dimensions
      let originalWidth = isVideo ? this.videoProcessor.videoElement.videoWidth : this.image.width;
      let originalHeight = isVideo ? this.videoProcessor.videoElement.videoHeight : this.image.height;

      // Calculate scaled dimensions
      let ratio = this.ratio || 1.0;
      //let ratio = 0.416;
      let scaledWidth = Math.floor(originalWidth * ratio);
      let scaledHeight = Math.floor(originalHeight * ratio);

      // Set canvas dimensions to scaled size
      this.canvas.width = scaledWidth;
      this.canvas.height = scaledHeight;

      console.log('CANVAS CREATION SIZE', this.canvas.width, this.canvas.height);

      try {
         this.context = this.canvas.getContext('webgpu', { alpha: true });
      } catch (error) {
         console.error('Error initializing WebGPU context:', error);
         throw error;
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

         if (!this.bufferManager) {
            this.bufferManager = new BufferManager(this.device);
         }
         if (!this.pipelineManager) {
            this.pipelineManager = new PipelineManager(this);
         }
         if (!this.commandQueue) {
            this.commandQueue = new CommandQueueManager(this.device);
         }

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
         console.log(this);
         console.log("IMAGE INDEX ", this.imageIndex);
         console.log(this.imageArray);

         try {
            if (this.imageArray.length > 0) {
               //this.imageIndex = 1;
               if (this.imageArray[this.imageIndex]) {

                  let response = await fetch(this.imageArray[this.imageIndex].filePath);
                  let blob = await response.blob();
                  let url = URL.createObjectURL(blob);

                  await this.loadImageSource(url);
                  await this.setupDevice();
                  await this.createResources();
               }
            }
            else {
               await this.setupDevice();
            }
         }
         catch (error) {
            console.error('Error initializing App:', error);
         }

      }
      catch (error) {
         console.error(`Group Binding: ${error}.`, error);
      }

   }

}

const SequentialGPU = {
   async createApp(settings) {
      const app = new App(settings);
      await app.initialize();
      return app;
   }
};

export { SequentialGPU, SequentialGPU as default };
//# sourceMappingURL=bundle.js.map
