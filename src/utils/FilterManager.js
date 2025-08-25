import RenderQueue from "../queue/renderQueue.js";

export class FilterManager {
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

        // Add render frame tracking
        this.renderFrameStats = {
            callCount: 0,
            totalCalls: 0,
            lastResetTime: performance.now(),
            callsPerSecond: 0
        };
        
        // Optional: Reset stats periodically
        this.statsResetInterval = setInterval(() => {
            this.calculateRenderFrameRate();
        }, 1000); // Calculate FPS every second

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
        const startTime = performance.now();
        
        return new Promise(resolve => {
            this.renderCompleteCallbacks.set(id, (completionData = {}) => {
                const duration = performance.now() - startTime;
                resolve({
                    success: true,
                    duration,
                    completedAt: performance.now(),
                    id,
                    queueStats: this.renderQueue.getStatus(),
                    renderStats: this.getRenderFrameStats(),
                    ...completionData
                });
            });
            
            // Set timeout to prevent infinite waiting
            setTimeout(() => {
                if (this.renderCompleteCallbacks.has(id)) {
                    console.warn("Render completion timeout triggered");
                    this.renderCompleteCallbacks.delete(id);
                    const duration = performance.now() - startTime;
                    resolve({
                        success: false,
                        timedOut: true,
                        duration,
                        completedAt: performance.now(),
                        id,
                        queueStats: this.renderQueue.getStatus(),
                        renderStats: this.getRenderFrameStats()
                    });
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
        const startTime = performance.now();

        const renderFrameStart = performance.now();

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

                const renderFrameTime = performance.now() - renderFrameStart;

                console.log(`📊 FilterManager timing: total=${performance.now() - startTime}ms, renderFrame=${renderFrameTime}ms`);

                
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
        // Increment counter at the start
        this.renderFrameStats.callCount++;
        this.renderFrameStats.totalCalls++;

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
        const completionData = {
            timestamp: performance.now(),
            queueEmpty: this.renderQueue.getStatus().pendingCount === 0,
            renderFrameStats: this.getRenderFrameStats()
        };
        
        for (const [id, callback] of this.renderCompleteCallbacks.entries()) {
            callback(completionData);
            this.renderCompleteCallbacks.delete(id);
        }
    }

    calculateRenderFrameRate() {
        const now = performance.now();
        const timeDiff = (now - this.renderFrameStats.lastResetTime) / 1000;
        this.renderFrameStats.callsPerSecond = this.renderFrameStats.callCount / timeDiff;
        
        // Optional: Log if calls seem excessive
        if (this.renderFrameStats.callsPerSecond > 120) { // More than 120 FPS
            console.warn(`renderFrame called ${this.renderFrameStats.callsPerSecond.toFixed(1)} times per second`);
        }

        // Reset for next interval
        this.renderFrameStats.callCount = 0;
        this.renderFrameStats.lastResetTime = now;

    }
    
    getRenderFrameStats() {
        return {
            callCount: this.renderFrameStats.callCount,
            totalCalls: this.renderFrameStats.totalCalls,
            callsPerSecond: this.renderFrameStats.callsPerSecond,
            lastResetTime: this.renderFrameStats.lastResetTime
        };
    }
    
    resetRenderFrameStats() {
        this.renderFrameStats.callCount = 0;
        this.renderFrameStats.lastResetTime = performance.now();
        this.renderFrameStats.callsPerSecond = 0;
    }
    // Clean up interval on disposal
    dispose() {
        if (this.statsResetInterval) {
            clearInterval(this.statsResetInterval);
            this.statsResetInterval = null;
        }
    }

}

export default FilterManager;