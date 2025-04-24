export class FilterManager {
    constructor(app) {
        this.app = app;

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
    async updateFilters(filterUpdateConditions = false) {
        for (const [key, filter] of Object.entries(this.filters)) {
            if (!filter?.active) continue;

            if (filterUpdateConditions.filters.includes(filter.label)) {

                if (filter.needsRender) {

                    if (filter.label === filterUpdateConditions.histogram) {
                        this.histogramNeedsUpdate = true;
                    }

                    const breakLoop = await this.renderFilterPasses(filter);
                    filter.needsRender = false;

                    if (breakLoop) return true;
                }
            } else {
                const breakLoop = await this.renderFilterPasses(filter);
                if (breakLoop) return true;
            }
        }
        return false;
    }
    onContextRecovered(device, context) {
        // Reset any cached state
        this.pendingUpdates = new Set();
        this.throttledUpdates = new Map();

        // Store references to new device/context
        this.app.device = device;
        this.app.context = context;

        // Schedule any necessary updates
        this.scheduleUpdate('contextRecovered');
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
        //console.log(`Waiting for render complete: ${id}`);
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

        try {
            await this.renderFrame(drawToCanvas, transformations, filterUpdateConditions);
        } catch (error) {
            console.error('Render error:', error);
            this.stopRender();
        }

    }

    async renderFrame(drawToCanvas, transformations, filterUpdateConditions) {
        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastFrameTime;

        // Skip frame if not enough time has elapsed
        if (deltaTime < this.frameInterval) {
            //console.log("Scheduling next frame due to deltaTime 1");
            this.scheduleNextFrame(drawToCanvas, transformations, filterUpdateConditions);
            return;
        }

        // Update filters and check if we should continue rendering
        const breakLoop = await this.updateFilters(filterUpdateConditions);

        // Update histogram if needed
        if (breakLoop && this.histogramNeedsUpdate && !this.app.videoProcessor?.isProcessingVideo) {
            await this.app.updateHistogram();
            this.histogramNeedsUpdate = false;
        }

        // Draw the frame
        this.drawFrame(drawToCanvas, transformations);

        // Update timing
        this.lastFrameTime = currentTime;

        // Handle render completion or schedule next frame
        if (breakLoop) {
            this.completeRender();
        } else {
            this.scheduleNextFrame(drawToCanvas, transformations, filterUpdateConditions);
        }
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
        this.notifyRenderComplete();
    }

    stopRender() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.app.isRendering = false;
    }

    notifyRenderComplete() {
        for (const [id, callback] of this.renderCompleteCallbacks.entries()) {
            callback();
            this.renderCompleteCallbacks.delete(id);
        }
    }

}

export default FilterManager;