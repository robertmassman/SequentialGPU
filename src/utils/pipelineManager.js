import PipelineCacheManager from "../memory/pipelineCacheManager.js";
import GPUUtils from '../core/gpuUtils.js';

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
            ...this.pipelineCacheManager.getCacheStats(), // Use getCacheStats() instead
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
                const errorDetails = {
                    label: filter.label || 'Unknown Shader',
                    summary: error.message,
                    details: this._parseShaderErrorMessage(error.message),
                    errorCount: 1
                };
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

export default PipelineManager;