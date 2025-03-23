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

export default UpdateManager;