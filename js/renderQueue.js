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
        this.debounceDelay = 0; // Immediate processing for performance
        this.autoProcess = true;

        // Optimized tracking - simplified
        this.maxDepth = 0;
        this.renderFrameStats = {
            totalCalls: 0
        };

        // Lightweight performance stats (without expensive per-operation timing)
        this.performanceStats = {
            totalOperations: 0,
            averageExecutionTime: 0, // Will be estimated
            lastOperationTime: 0,
            fastPathHits: 0
        };

        // Object pool to reduce memory allocation overhead
        this.wrapperPool = [];
        this.poolSize = 10;
        this.idCounter = 0; // Faster than timestamp + random

        // Pre-populate object pool
        for (let i = 0; i < this.poolSize; i++) {
            this.wrapperPool.push(this.createWrapperObject());
        }

        // Fast path flags
        this.hasHighPriorityOps = false;
        this.lastProcessTime = 0;
    }

    // Fast object creation for pooling
    createWrapperObject() {
        return {
            id: null,
            operation: null,
            priority: 'normal',
            metadata: null,
            resolve: null,
            reject: null,
            settled: false,
            timeoutId: null
        };
    }

    // Optimized queue method with object pooling and fast path
    queue(operation, priority = 'normal', metadata = {}) {
        this.renderFrameStats.totalCalls++;

        // Fast path: if not processing and queue is empty, execute immediately
        if (!this.isProcessing && this.pendingOperations.size === 0 && priority === 'normal') {
            return this.executeImmediate(operation);
        }

        // Get wrapper from pool or create new one
        const wrapper = this.wrapperPool.pop() || this.createWrapperObject();
        
        // Fast ID generation
        wrapper.id = ++this.idCounter;
        wrapper.operation = operation;
        wrapper.priority = priority;
        wrapper.metadata = metadata;
        wrapper.settled = false;

        // Simplified promise without timeout overhead for normal operations
        const promise = new Promise((resolve, reject) => {
            wrapper.resolve = resolve;
            wrapper.reject = reject;
        });

        this.pendingOperations.set(wrapper.id, wrapper);
        this.stats.queued++;

        // Track priority for processing optimization
        if (priority === 'high' || priority === 'urgent') {
            this.hasHighPriorityOps = true;
        }

        // Update max depth efficiently
        if (this.pendingOperations.size > this.maxDepth) {
            this.maxDepth = this.pendingOperations.size;
        }

        if (this.autoProcess) {
            this.scheduleProcess();
        }

        return promise;
    }

    // Fast path execution for single operations
    async executeImmediate(operation) {
        this.isProcessing = true;
        try {
            const result = await operation();
            this.stats.completed++;
            this.performanceStats.totalOperations++;
            this.performanceStats.fastPathHits++;
            return result;
        } catch (error) {
            this.stats.failed++;
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    scheduleProcess() {
        // Immediate processing if no debounce delay
        if (this.debounceDelay === 0) {
            if (!this.isProcessing && this.pendingOperations.size > 0) {
                this.process().catch(error => {
                    console.error('Auto-process error:', error);
                });
            }
            return;
        }

        // Standard debounced processing
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
        }, this.debounceDelay);
    }

    getRenderFrameStats() {
        return { ...this.renderFrameStats };
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
            // Optimized processing loop
            while (this.pendingOperations.size > 0) {
                let operationToExecute;

                // Fast path: single operation or no priority sorting needed
                if (this.pendingOperations.size === 1 || !this.hasHighPriorityOps) {
                    // Take first operation without sorting overhead
                    const [id, wrapper] = this.pendingOperations.entries().next().value;
                    operationToExecute = { id, wrapper };
                } else {
                    // Optimized sorting: only when multiple operations with different priorities
                    const operations = Array.from(this.pendingOperations.entries());
                    operations.sort(([idA, opA], [idB, opB]) => {
                        const priorityDiff = this.getPriorityValue(opB.priority) - this.getPriorityValue(opA.priority);
                        return priorityDiff;
                    });
                    operationToExecute = { id: operations[0][0], wrapper: operations[0][1] };
                }

                const { id, wrapper } = operationToExecute;
                const { operation, resolve, reject } = wrapper;

                // Remove from queue
                this.pendingOperations.delete(id);
                this.stats.queued--;
                this.currentOperation = { id, metadata: wrapper.metadata };

                try {
                    // Execute operation with lightweight timing
                    const startTime = this.performanceStats.totalOperations % 10 === 0 ? performance.now() : 0;
                    const result = await operation();
                    if (startTime > 0) {
                        this.performanceStats.lastOperationTime = performance.now() - startTime;
                        // Update average (simple moving average)
                        this.performanceStats.averageExecutionTime = 
                            (this.performanceStats.averageExecutionTime * 0.9) + 
                            (this.performanceStats.lastOperationTime * 0.1);
                    }
                    this.stats.completed++;
                    this.performanceStats.totalOperations++;
                    
                    // Resolve and return wrapper to pool
                    if (resolve && !wrapper.settled) {
                        wrapper.settled = true;
                        resolve(result);
                    }
                } catch (error) {
                    this.stats.failed++;
                    if (reject && !wrapper.settled) {
                        wrapper.settled = true;
                        reject(error);
                    }
                }

                // Return wrapper to pool for reuse
                this.returnWrapperToPool(wrapper);
                this.currentOperation = null;
            }

            // Reset priority flag when queue is empty
            this.hasHighPriorityOps = false;

        } catch (criticalError) {
            this.handleProcessError(criticalError);
            throw criticalError;
        } finally {
            this.isProcessing = false;
        }
    }

    // Return wrapper object to pool for reuse
    returnWrapperToPool(wrapper) {
        // Reset wrapper properties
        wrapper.id = null;
        wrapper.operation = null;
        wrapper.priority = 'normal';
        wrapper.metadata = null;
        wrapper.resolve = null;
        wrapper.reject = null;
        wrapper.settled = false;
        wrapper.timeoutId = null;

        // Only keep pool at reasonable size
        if (this.wrapperPool.length < this.poolSize) {
            this.wrapperPool.push(wrapper);
        }
    }

    // Simplified stats
    resetStats() {
        this.stats = {
            completed: 0,
            failed: 0,
            queued: this.pendingOperations.size
        };
        this.performanceStats = {
            totalOperations: 0,
            averageExecutionTime: 0,
            lastOperationTime: 0,
            fastPathHits: 0
        };
    }

    // Simplified status
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
        return this.idCounter++; // Much faster than timestamp + random
    }

    cancel(id) {
        return this.pendingOperations.delete(id);
    }

    // Simplified clear method
    clear(force = false) {
        if (!force && this.isProcessing) {
            this.stopAfterCurrent();
            return;
        }

        // Return all wrappers to pool before clearing
        for (const [id, wrapper] of this.pendingOperations.entries()) {
            if (wrapper.reject && !wrapper.settled) {
                wrapper.settled = true;
                wrapper.reject(new Error('Queue cleared'));
            }
            this.returnWrapperToPool(wrapper);
        }

        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
            this.processTimeout = null;
        }

        this.pendingOperations.clear();
        this.stats.queued = 0;
        this.currentOperation = null;
        this.hasHighPriorityOps = false;
    }

    getRenderFrameStats() {
        return { ...this.renderFrameStats };
    }

    // Lightweight performance stats without expensive per-operation timing
    getPerformanceStats() {
        return {
            totalOperations: this.performanceStats.totalOperations,
            averageExecutionTime: this.performanceStats.averageExecutionTime,
            lastOperationTime: this.performanceStats.lastOperationTime,
            fastPathHits: this.performanceStats.fastPathHits,
            fastPathRatio: this.performanceStats.totalOperations > 0 ? 
                (this.performanceStats.fastPathHits / this.performanceStats.totalOperations) : 0,
            // Legacy compatibility fields
            maxExecutionTime: this.performanceStats.lastOperationTime,
            minExecutionTime: this.performanceStats.lastOperationTime,
            currentExecutionTime: this.performanceStats.lastOperationTime
        };
    }

    // Immediate processing for debugging
    async processNow() {
        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
            this.processTimeout = null;
        }
        return this.process();
    }

    // Cancel operations by metadata
    cancelByMetadata(key, value) {
        let cancelled = 0;
        for (const [id, wrapper] of this.pendingOperations.entries()) {
            if (wrapper.metadata && wrapper.metadata[key] === value) {
                if (wrapper.reject && !wrapper.settled) {
                    wrapper.settled = true;
                    wrapper.reject(new Error('Operation cancelled'));
                }
                this.pendingOperations.delete(id);
                this.returnWrapperToPool(wrapper);
                cancelled++;
                this.stats.queued = Math.max(0, this.stats.queued - 1);
            }
        }
        return cancelled;
    }

    
    // Simplified graceful stop
    stopAfterCurrent() {
        const currentId = this.currentOperation?.id;

        for (const [id, wrapper] of this.pendingOperations.entries()) {
            if (id !== currentId && wrapper.reject && !wrapper.settled) {
                try {
                    wrapper.settled = true;
                    wrapper.reject(new Error('Queue stopped'));
                } catch (error) {
                    console.warn(`Failed to reject operation ${id}:`, error);
                }
                this.returnWrapperToPool(wrapper);
            }
        }

        // Remove all except current operation
        if (currentId && this.pendingOperations.has(currentId)) {
            const currentWrapper = this.pendingOperations.get(currentId);
            this.pendingOperations.clear();
            this.pendingOperations.set(currentId, currentWrapper);
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