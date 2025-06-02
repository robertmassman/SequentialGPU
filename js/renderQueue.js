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

export default RenderQueue;