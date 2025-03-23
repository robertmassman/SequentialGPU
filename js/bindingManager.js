import ErrorHandler from './errorHandler.js';

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

export default BindingManager;