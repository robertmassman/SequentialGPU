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

            console.log('Attempting to recover WebGPU context...');

            // Stop any active rendering to prevent further errors
            this.isRendering = false;

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
            else{
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

export default RecoveryManager