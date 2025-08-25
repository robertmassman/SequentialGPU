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
    /*static debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }*/
}

export default GPUUtils;