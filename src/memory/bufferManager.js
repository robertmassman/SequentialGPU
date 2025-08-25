class BufferManager {
    constructor(device) {
        this.device = device;

        // Initialize buffer tracking - THIS IS CRITICAL
        this.bufferStats = {
            totalCreated: 0,
            currentCount: 0,
            totalMemoryBytes: 0
        };

        // Optional: also initialize tracked buffers set
        this.trackedBuffers = new Set();
    }


    /**
     * Creates a tracked buffer with consistent settings
     * @param {Object} descriptor - Buffer descriptor
     * @returns {GPUBuffer} Created buffer with tracking
     */
    createTrackedBuffer(descriptor) {
        const buffer = this.device.createBuffer(descriptor);

        // Update stats
        this.bufferStats.totalCreated++;
        this.bufferStats.currentCount++;
        this.bufferStats.totalMemoryBytes += descriptor.size;

        //console.log(`🔧 Buffer created: ${descriptor.size} bytes, total: ${this.bufferStats.totalMemoryBytes}`);

        return buffer;
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
        if (!filter.bufferAttachment?.bindings) {
            return null;
        }



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

        try {
            // Create the buffer
            //const buffer = this.device.createBuffer({
            //    size: Math.max(floatsSize, 16),
            //    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            //    label: `${filter.label} Buffer`
            //});
            // To this:
            const buffer = this.createTrackedBuffer({
                //size: layout.totalSize,
                size: Math.max(floatsSize, 16),
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                label: `${filter.label || 'filter'}-buffer`
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

        } catch (error) {
            console.error('Error creating filter buffers:', error);
            throw error;
        }
    }

    /**
     * Release a tracked buffer
     * @param {GPUBuffer} buffer - Buffer to release
     */
    releaseBuffer(buffer) {
        for (const trackedBuffer of this.trackedBuffers) {
            if (trackedBuffer.buffer === buffer) {
                this.trackedBuffers.delete(trackedBuffer);
                this.bufferStats.currentCount--;
                this.bufferStats.totalMemoryBytes -= trackedBuffer.size;

                // Destroy the buffer
                try {
                    buffer.destroy();
                } catch (error) {
                    console.warn('Error destroying buffer:', error);
                }
                break;
            }
        }
    }

    /**
     * Get memory statistics for tracked buffers
     * @returns {Object} Buffer memory statistics
     */
    /*getMemoryStats() {
        return {
            ...this.bufferStats,
            averageBufferSize: this.bufferStats.currentCount > 0 ? 
            this.bufferStats.totalMemoryBytes / this.bufferStats.currentCount : 0,
            memoryMB: Math.round(this.bufferStats.totalMemoryBytes / (1024 * 1024) * 100) / 100
        };
    }*/
    getMemoryStats() {
        // Add some debugging to see what's happening
        //console.log("📊 getMemoryStats called, bufferStats:", this.bufferStats);

        return {
            ...this.bufferStats,
            averageBufferSize: this.bufferStats.currentCount > 0 ?
                this.bufferStats.totalMemoryBytes / this.bufferStats.currentCount : 0,
            memoryMB: Math.round(this.bufferStats.totalMemoryBytes / (1024 * 1024) * 100) / 100
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

    /**
     * Clean up all tracked buffers
     */
    dispose() {
        for (const trackedBuffer of this.trackedBuffers) {
            try {
                trackedBuffer.buffer.destroy();
            } catch (error) {
                console.warn('Error destroying buffer during disposal:', error);
            }
        }
        this.trackedBuffers.clear();
        this.bufferStats = {
            totalCreated: 0,
            currentCount: 0,
            totalMemoryBytes: 0
        };
    }
}

export default BufferManager;

