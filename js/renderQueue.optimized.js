/**
 * Production-Optimized RenderQueue for SequentialGPU
 * Minimal overhead queue processing with conditional debug features
 */

import { getBuildConfig } from '../build.config.js';
import { getPerformanceTracker } from './performanceTracker.js';

class RenderQueue {
    constructor() {
        this.config = getBuildConfig();
        this.performanceTracker = this.config.enablePerformanceTracking ? getPerformanceTracker() : null;
        
        // Core queue state - minimal for production
        this.pendingOperations = new Map();
        this.isProcessing = false;
        this.currentOperation = null;
        
        // Optimized settings based on build type
        this.debounceDelay = this.config.queueOptimizations.debounceDelay;
        this.autoProcess = true;
        this.processTimeout = null;
        
        // Object pooling - essential for performance
        this.wrapperPool = [];
        this.poolSize = this.config.queueOptimizations.maxPoolSize;
        this.idCounter = 0;
        
        // Pre-populate object pool
        for (let i = 0; i < this.poolSize; i++) {
            this.wrapperPool.push(this.createWrapperObject());
        }
        
        // Fast path optimization flags
        this.hasHighPriorityOps = false;
        this.lastProcessTime = 0;
        
        // Conditional statistics - only in non-production builds
        if (!this.config.isProduction) {
            this.initializeDebugFeatures();
        }
    }
    
    initializeDebugFeatures() {
        this.stats = {
            completed: 0,
            failed: 0,
            queued: 0
        };
        
        this.maxDepth = 0;
        this.renderFrameStats = {
            totalCalls: 0,
            callsPerSecond: 0,
            lastResetTime: performance.now()
        };
        
        this.performanceStats = {
            totalOperations: 0,
            averageExecutionTime: 0,
            lastOperationTime: 0,
            fastPathHits: 0,
            maxExecutionTime: 0,
            minExecutionTime: Infinity
        };
        
        // Reset stats periodically in debug mode
        this.statsResetInterval = setInterval(() => {
            this.calculateRenderFrameRate();
        }, 1000);
    }
    
    createWrapperObject() {
        return {
            id: null,
            operation: null,
            priority: 'normal',
            metadata: null,
            resolve: null,
            reject: null,
            settled: false
        };
    }
    
    /**
     * Primary queue method - highly optimized for production
     */
    queue(operation, priority = 'normal', metadata = {}) {
        // Performance tracking (debug only)
        let perfContext = null;
        if (!this.config.isProduction && this.performanceTracker) {
            perfContext = this.performanceTracker.startQueueOperation(this.idCounter + 1, priority);
        }
        
        // Update debug stats
        if (!this.config.isProduction) {
            this.renderFrameStats.totalCalls++;
        }
        
        // PRODUCTION FAST PATH: Immediate execution when possible
        if (!this.isProcessing && this.pendingOperations.size === 0 && priority === 'normal') {
            return this.executeImmediate(operation, perfContext);
        }
        
        // Standard queueing path
        const wrapper = this.getWrapperFromPool();
        wrapper.id = ++this.idCounter;
        wrapper.operation = operation;
        wrapper.priority = priority;
        wrapper.metadata = metadata;
        wrapper.settled = false;
        
        const promise = new Promise((resolve, reject) => {
            wrapper.resolve = resolve;
            wrapper.reject = reject;
        });
        
        this.pendingOperations.set(wrapper.id, wrapper);
        
        // Update debug statistics
        if (!this.config.isProduction) {
            this.stats.queued++;
            if (this.pendingOperations.size > this.maxDepth) {
                this.maxDepth = this.pendingOperations.size;
            }
            if (this.performanceTracker) {
                this.performanceTracker.recordQueueDepth(this.pendingOperations.size);
            }
        }
        
        // Priority tracking for processing optimization
        if (priority === 'high' || priority === 'urgent') {
            this.hasHighPriorityOps = true;
        }
        
        if (this.autoProcess) {
            this.scheduleProcess();
        }
        
        return promise;
    }
    
    /**
     * Production-optimized immediate execution
     */
    async executeImmediate(operation, perfContext = null) {
        this.isProcessing = true;
        
        let startTime;
        if (!this.config.isProduction) {
            startTime = performance.now();
        }
        
        try {
            const result = await operation();
            
            // Performance tracking (debug only)
            if (!this.config.isProduction) {
                const duration = performance.now() - startTime;
                this.updatePerformanceStats(duration, true);
                this.stats.completed++;
                if (this.performanceTracker) {
                    this.performanceTracker.recordFastPath();
                }
            }
            
            if (perfContext && this.performanceTracker) {
                this.performanceTracker.endQueueOperation(perfContext, true);
            }
            return result;
            
        } catch (error) {
            if (!this.config.isProduction) {
                this.stats.failed++;
            }
            if (perfContext && this.performanceTracker) {
                this.performanceTracker.endQueueOperation(perfContext, false);
            }
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }
    
    getWrapperFromPool() {
        return this.wrapperPool.pop() || this.createWrapperObject();
    }
    
    returnWrapperToPool(wrapper) {
        // Reset wrapper
        wrapper.id = null;
        wrapper.operation = null;
        wrapper.priority = 'normal';
        wrapper.metadata = null;
        wrapper.resolve = null;
        wrapper.reject = null;
        wrapper.settled = false;
        
        // Return to pool if under size limit
        if (this.wrapperPool.length < this.poolSize) {
            this.wrapperPool.push(wrapper);
        }
    }
    
    scheduleProcess() {
        // PRODUCTION OPTIMIZATION: Immediate processing (no debounce)
        if (this.debounceDelay === 0) {
            if (!this.isProcessing && this.pendingOperations.size > 0) {
                this.process().catch(error => {
                    if (this.config.enableDebugLogging) {
                        console.error('Auto-process error:', error);
                    }
                });
            }
            return;
        }
        
        // Debounced processing for debug builds
        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
        }
        
        this.processTimeout = setTimeout(() => {
            this.processTimeout = null;
            if (!this.isProcessing && this.pendingOperations.size > 0) {
                this.process().catch(error => {
                    if (this.config.enableDebugLogging) {
                        console.error('Auto-process error:', error);
                    }
                });
            }
        }, this.debounceDelay);
    }
    
    /**
     * Highly optimized queue processing
     */
    async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        
        try {
            while (this.pendingOperations.size > 0) {
                const operationToExecute = this.getNextOperation();
                const { id, wrapper } = operationToExecute;
                const { operation, resolve, reject } = wrapper;
                
                // Remove from queue first
                this.pendingOperations.delete(id);
                if (!this.config.isProduction) {
                    this.stats.queued--;
                    this.currentOperation = { id, metadata: wrapper.metadata };
                }
                
                try {
                    // Performance measurement (debug only)
                    let startTime;
                    if (!this.config.isProduction) {
                        startTime = performance.now();
                    }
                    
                    const result = await operation();
                    
                    // Update statistics (debug only)
                    if (!this.config.isProduction) {
                        const duration = performance.now() - startTime;
                        this.updatePerformanceStats(duration, false);
                        this.stats.completed++;
                    }
                    
                    if (resolve && !wrapper.settled) {
                        wrapper.settled = true;
                        resolve(result);
                    }
                    
                } catch (error) {
                    if (!this.config.isProduction) {
                        this.stats.failed++;
                    }
                    
                    if (reject && !wrapper.settled) {
                        wrapper.settled = true;
                        reject(error);
                    }
                }
                
                this.returnWrapperToPool(wrapper);
                
                if (!this.config.isProduction) {
                    this.currentOperation = null;
                }
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
    
    /**
     * Optimized operation selection
     */
    getNextOperation() {
        // PRODUCTION FAST PATH: Take first operation when no priority sorting needed
        if (this.pendingOperations.size === 1 || (!this.hasHighPriorityOps && this.config.isProduction)) {
            const [id, wrapper] = this.pendingOperations.entries().next().value;
            return { id, wrapper };
        }
        
        // Priority-based selection for complex scenarios
        const operations = Array.from(this.pendingOperations.entries());
        operations.sort(([idA, opA], [idB, opB]) => {
            return this.getPriorityValue(opB.priority) - this.getPriorityValue(opA.priority);
        });
        
        return { id: operations[0][0], wrapper: operations[0][1] };
    }
    
    updatePerformanceStats(duration, isFastPath) {
        if (this.config.isProduction) return;
        
        this.performanceStats.totalOperations++;
        this.performanceStats.lastOperationTime = duration;
        
        if (isFastPath) {
            this.performanceStats.fastPathHits++;
        }
        
        // Update min/max
        this.performanceStats.maxExecutionTime = Math.max(this.performanceStats.maxExecutionTime, duration);
        this.performanceStats.minExecutionTime = Math.min(this.performanceStats.minExecutionTime, duration);
        
        // Calculate rolling average (lightweight)
        this.performanceStats.averageExecutionTime = 
            (this.performanceStats.averageExecutionTime * 0.9) + (duration * 0.1);
    }
    
    calculateRenderFrameRate() {
        if (this.config.isProduction) return;
        
        const now = performance.now();
        const timeDiff = now - this.renderFrameStats.lastResetTime;
        
        if (timeDiff >= 1000) {
            this.renderFrameStats.callsPerSecond = 
                (this.renderFrameStats.totalCalls * 1000) / timeDiff;
            this.renderFrameStats.totalCalls = 0;
            this.renderFrameStats.lastResetTime = now;
        }
    }
    
    handleProcessError(error) {
        if (this.config.enableDebugLogging) {
            console.error('Critical render queue error:', error);
        }
        
        const pendingCount = this.pendingOperations.size;
        
        // Reject all pending operations
        for (const [id, operation] of this.pendingOperations.entries()) {
            if (operation.reject && !operation.settled) {
                operation.settled = true;
                operation.reject(new Error('Queue processing failed: ' + error.message));
            }
            this.returnWrapperToPool(operation);
        }
        
        this.pendingOperations.clear();
        this.hasHighPriorityOps = false;
        
        if (!this.config.isProduction) {
            this.stats.queued = 0;
            this.stats.failed += pendingCount;
            this.currentOperation = null;
        }
        
        this.isProcessing = false;
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
    
    // Public API methods (optimized based on build type)
    
    getStatus() {
        const baseStatus = {
            isProcessing: this.isProcessing,
            pendingCount: this.pendingOperations.size
        };
        
        if (this.config.isProduction) {
            return baseStatus;
        }
        
        return {
            ...baseStatus,
            currentOperation: this.currentOperation,
            stats: { ...this.stats },
            performanceStats: { ...this.performanceStats }
        };
    }
    
    getPerformanceStats() {
        if (this.config.isProduction) {
            return {
                totalOperations: this.performanceStats?.totalOperations || 0,
                fastPathHits: this.performanceStats?.fastPathHits || 0
            };
        }
        
        return {
            totalOperations: this.performanceStats.totalOperations,
            averageExecutionTime: this.performanceStats.averageExecutionTime,
            lastOperationTime: this.performanceStats.lastOperationTime,
            fastPathHits: this.performanceStats.fastPathHits,
            fastPathRatio: this.performanceStats.totalOperations > 0 ? 
                (this.performanceStats.fastPathHits / this.performanceStats.totalOperations) : 0,
            maxExecutionTime: this.performanceStats.maxExecutionTime,
            minExecutionTime: this.performanceStats.minExecutionTime
        };
    }
    
    getRenderFrameStats() {
        if (this.config.isProduction) {
            return { callsPerSecond: 0 };
        }
        
        return { ...this.renderFrameStats };
    }
    
    cancel(id) {
        const wrapper = this.pendingOperations.get(id);
        if (wrapper) {
            if (wrapper.reject && !wrapper.settled) {
                wrapper.settled = true;
                wrapper.reject(new Error('Operation cancelled'));
            }
            this.pendingOperations.delete(id);
            this.returnWrapperToPool(wrapper);
            
            if (!this.config.isProduction) {
                this.stats.queued = Math.max(0, this.stats.queued - 1);
            }
            
            return true;
        }
        return false;
    }
    
    clear(force = false) {
        if (!force && this.isProcessing) {
            this.stopAfterCurrent();
            return;
        }
        
        // Return all wrappers to pool
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
        this.hasHighPriorityOps = false;
        
        if (!this.config.isProduction) {
            this.stats.queued = 0;
            this.currentOperation = null;
        }
    }
    
    stopAfterCurrent() {
        const currentId = this.currentOperation?.id;
        
        for (const [id, wrapper] of this.pendingOperations.entries()) {
            if (id !== currentId && wrapper.reject && !wrapper.settled) {
                wrapper.settled = true;
                wrapper.reject(new Error('Queue stopped'));
                this.returnWrapperToPool(wrapper);
            }
        }
        
        // Keep only current operation
        if (currentId && this.pendingOperations.has(currentId)) {
            const currentWrapper = this.pendingOperations.get(currentId);
            this.pendingOperations.clear();
            this.pendingOperations.set(currentId, currentWrapper);
            
            if (!this.config.isProduction) {
                this.stats.queued = 1;
            }
        } else {
            this.pendingOperations.clear();
            if (!this.config.isProduction) {
                this.stats.queued = 0;
            }
        }
        
        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
            this.processTimeout = null;
        }
        
        this.hasHighPriorityOps = false;
    }
    
    async processNow() {
        if (this.processTimeout) {
            clearTimeout(this.processTimeout);
            this.processTimeout = null;
        }
        return this.process();
    }
    
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
                
                if (!this.config.isProduction) {
                    this.stats.queued = Math.max(0, this.stats.queued - 1);
                }
            }
        }
        
        return cancelled;
    }
    
    // High-priority operations for urgent rendering
    urgentQueue(operation, metadata = {}) {
        return this.queue(operation, 'urgent', { ...metadata, urgent: true });
    }
    
    // Background operations for non-critical tasks
    backgroundQueue(operation, metadata = {}) {
        return this.queue(operation, 'background', { ...metadata, background: true });
    }
    
    dispose() {
        if (this.statsResetInterval) {
            clearInterval(this.statsResetInterval);
        }
        
        this.clear(true);
        this.wrapperPool.length = 0;
        
        if (this.performanceTracker) {
            this.performanceTracker.dispose();
        }
    }
}

export { RenderQueue };
