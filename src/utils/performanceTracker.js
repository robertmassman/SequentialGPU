/**
 * Performance Tracking System for SequentialGPU
 * Comprehensive performance monitoring for debug builds
 */

import { getBuildConfig } from '../../build.config.js';

class PerformanceTracker {
    constructor() {
        this.config = getBuildConfig();
        this.enabled = this.config.enablePerformanceTracking;
        
        if (!this.enabled) {
            // In production, become a no-op class
            this.makeNoOp();
            return;
        }
        
        this.metrics = {
            // Queue performance
            queue: {
                operationTimes: [],
                avgProcessingTime: 0,
                maxProcessingTime: 0,
                minProcessingTime: Infinity,
                totalOperations: 0,
                fastPathHits: 0,
                queueDepthHistory: [],
                priorityDistribution: new Map()
            },
            
            // GPU metrics
            gpu: {
                commandBufferSubmissions: 0,
                commandBufferTimes: [],
                pipelineCreations: 0,
                pipelineCacheHits: 0,
                pipelineCacheMisses: 0,
                bindGroupCreations: 0,
                bindGroupCacheHits: 0
            },
            
            // Resource tracking
            resources: {
                textureAllocations: 0,
                textureReleases: 0,
                bufferAllocations: 0,
                bufferReleases: 0,
                memoryUsage: {
                    textures: 0,
                    buffers: 0,
                    total: 0
                },
                leakDetection: new Map()
            },
            
            // Synchronization overhead
            sync: {
                waitTimes: [],
                lockContentions: 0,
                asyncChainDepth: [],
                promiseResolutionTimes: []
            },
            
            // Render performance
            render: {
                frameTimings: [],
                renderCalls: 0,
                batchingEfficiency: [],
                droppedFrames: 0,
                averageFPS: 0
            }
        };
        
        this.samplingInterval = 100; // Sample every 100 operations
        this.maxHistorySize = 1000;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        
        // Performance monitoring intervals
        this.setupMonitoring();
    }
    
    makeNoOp() {
        // Convert all methods to no-ops for production builds
        const noOp = () => {};
        const noOpReturn = (val) => val;
        
        Object.getOwnPropertyNames(PerformanceTracker.prototype)
            .filter(prop => prop !== 'constructor')
            .forEach(prop => {
                if (typeof this[prop] === 'function') {
                    this[prop] = prop.includes('get') || prop.includes('calculate') ? 
                        noOpReturn : noOp;
                }
            });
    }
    
    setupMonitoring() {
        if (!this.enabled) return;
        
        // FPS monitoring
        this.fpsInterval = setInterval(() => {
            this.calculateFPS();
        }, 1000);
        
        // Memory leak detection
        this.leakCheckInterval = setInterval(() => {
            this.checkForMemoryLeaks();
        }, 5000);
    }
    
    // Queue Performance Tracking
    startQueueOperation(operationId, priority = 'normal') {
        if (!this.enabled) return {};
        
        const startTime = performance.now();
        this.metrics.queue.priorityDistribution.set(
            priority, 
            (this.metrics.queue.priorityDistribution.get(priority) || 0) + 1
        );
        
        return { startTime, operationId, priority };
    }
    
    endQueueOperation(context, success = true) {
        if (!this.enabled || !context) return;
        
        const endTime = performance.now();
        const duration = endTime - context.startTime;
        
        this.metrics.queue.operationTimes.push(duration);
        this.metrics.queue.totalOperations++;
        
        // Update statistics
        this.metrics.queue.maxProcessingTime = Math.max(this.metrics.queue.maxProcessingTime, duration);
        this.metrics.queue.minProcessingTime = Math.min(this.metrics.queue.minProcessingTime, duration);
        
        // Calculate rolling average
        const times = this.metrics.queue.operationTimes;
        if (times.length > this.maxHistorySize) {
            times.shift();
        }
        this.metrics.queue.avgProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;
        
        // Check performance targets
        if (duration > this.config.performanceTargets.queueOverhead) {
            this.reportPerformanceWarning('queue', duration);
        }
    }
    
    recordFastPath() {
        if (!this.enabled) return;
        this.metrics.queue.fastPathHits++;
    }
    
    recordQueueDepth(depth) {
        if (!this.enabled) return;
        this.metrics.queue.queueDepthHistory.push({
            depth,
            timestamp: performance.now()
        });
        
        if (this.metrics.queue.queueDepthHistory.length > this.maxHistorySize) {
            this.metrics.queue.queueDepthHistory.shift();
        }
    }
    
    // GPU Performance Tracking
    startGPUCommand(commandType) {
        if (!this.enabled) return {};
        return { startTime: performance.now(), commandType };
    }
    
    endGPUCommand(context) {
        if (!this.enabled || !context) return;
        
        const duration = performance.now() - context.startTime;
        this.metrics.gpu.commandBufferTimes.push(duration);
        this.metrics.gpu.commandBufferSubmissions++;
        
        if (duration > this.config.performanceTargets.gpuCommandSubmission) {
            this.reportPerformanceWarning('gpu', duration);
        }
    }
    
    recordPipelineCreation() {
        if (!this.enabled) return;
        this.metrics.gpu.pipelineCreations++;
    }
    
    recordPipelineCacheHit() {
        if (!this.enabled) return;
        this.metrics.gpu.pipelineCacheHits++;
    }
    
    recordPipelineCacheMiss() {
        if (!this.enabled) return;
        this.metrics.gpu.pipelineCacheMisses++;
    }
    
    // Resource Tracking
    recordResourceAllocation(type, size, resourceId) {
        if (!this.enabled) return;
        
        if (type === 'texture') {
            this.metrics.resources.textureAllocations++;
            this.metrics.resources.memoryUsage.textures += size;
        } else if (type === 'buffer') {
            this.metrics.resources.bufferAllocations++;
            this.metrics.resources.memoryUsage.buffers += size;
        }
        
        this.metrics.resources.memoryUsage.total += size;
        
        // Track for leak detection
        this.metrics.resources.leakDetection.set(resourceId, {
            type,
            size,
            allocated: performance.now()
        });
    }
    
    recordResourceRelease(resourceId) {
        if (!this.enabled) return;
        
        const resource = this.metrics.resources.leakDetection.get(resourceId);
        if (resource) {
            if (resource.type === 'texture') {
                this.metrics.resources.textureReleases++;
                this.metrics.resources.memoryUsage.textures -= resource.size;
            } else if (resource.type === 'buffer') {
                this.metrics.resources.bufferReleases++;
                this.metrics.resources.memoryUsage.buffers -= resource.size;
            }
            
            this.metrics.resources.memoryUsage.total -= resource.size;
            this.metrics.resources.leakDetection.delete(resourceId);
        }
    }
    
    checkForMemoryLeaks() {
        if (!this.enabled) return;
        
        const now = performance.now();
        const leakThreshold = 60000; // 1 minute
        
        for (const [resourceId, resource] of this.metrics.resources.leakDetection) {
            if (now - resource.allocated > leakThreshold) {
                console.warn(`Potential memory leak detected: ${resource.type} ${resourceId} allocated ${Math.round((now - resource.allocated) / 1000)}s ago`);
            }
        }
    }
    
    // Synchronization Tracking
    startAsyncOperation() {
        if (!this.enabled) return {};
        return { startTime: performance.now() };
    }
    
    endAsyncOperation(context) {
        if (!this.enabled || !context) return;
        
        const duration = performance.now() - context.startTime;
        this.metrics.sync.promiseResolutionTimes.push(duration);
        
        if (this.metrics.sync.promiseResolutionTimes.length > this.maxHistorySize) {
            this.metrics.sync.promiseResolutionTimes.shift();
        }
    }
    
    recordLockContention() {
        if (!this.enabled) return;
        this.metrics.sync.lockContentions++;
    }
    
    // Render Performance
    startFrame() {
        if (!this.enabled) return {};
        return { startTime: performance.now() };
    }
    
    endFrame(context) {
        if (!this.enabled || !context) return;
        
        const frameTime = performance.now() - context.startTime;
        this.metrics.render.frameTimings.push(frameTime);
        this.metrics.render.renderCalls++;
        
        if (frameTime > this.config.performanceTargets.maxFrameTime) {
            this.metrics.render.droppedFrames++;
        }
        
        if (this.metrics.render.frameTimings.length > this.maxHistorySize) {
            this.metrics.render.frameTimings.shift();
        }
        
        this.lastFrameTime = performance.now();
    }
    
    calculateFPS() {
        if (!this.enabled) return 0;
        
        const recentFrames = this.metrics.render.frameTimings.slice(-60); // Last 60 frames
        if (recentFrames.length === 0) return 0;
        
        const avgFrameTime = recentFrames.reduce((a, b) => a + b, 0) / recentFrames.length;
        this.metrics.render.averageFPS = 1000 / avgFrameTime;
        return this.metrics.render.averageFPS;
    }
    
    recordBatchingEfficiency(batchSize, totalOperations) {
        if (!this.enabled) return;
        
        const efficiency = batchSize / totalOperations;
        this.metrics.render.batchingEfficiency.push(efficiency);
        
        if (this.metrics.render.batchingEfficiency.length > this.maxHistorySize) {
            this.metrics.render.batchingEfficiency.shift();
        }
    }
    
    // Performance Analysis
    getPerformanceSummary() {
        if (!this.enabled) return null;
        
        return {
            queue: {
                avgProcessingTime: this.metrics.queue.avgProcessingTime,
                maxProcessingTime: this.metrics.queue.maxProcessingTime,
                totalOperations: this.metrics.queue.totalOperations,
                fastPathRatio: this.metrics.queue.fastPathHits / this.metrics.queue.totalOperations,
                averageQueueDepth: this.calculateAverageQueueDepth()
            },
            gpu: {
                commandSubmissions: this.metrics.gpu.commandBufferSubmissions,
                avgCommandTime: this.calculateAverage(this.metrics.gpu.commandBufferTimes),
                pipelineCacheHitRatio: this.metrics.gpu.pipelineCacheHits / 
                    (this.metrics.gpu.pipelineCacheHits + this.metrics.gpu.pipelineCacheMisses)
            },
            resources: {
                memoryUsage: this.metrics.resources.memoryUsage,
                activeLeaks: this.metrics.resources.leakDetection.size,
                allocationBalance: {
                    textures: this.metrics.resources.textureAllocations - this.metrics.resources.textureReleases,
                    buffers: this.metrics.resources.bufferAllocations - this.metrics.resources.bufferReleases
                }
            },
            render: {
                averageFPS: this.metrics.render.averageFPS,
                droppedFrames: this.metrics.render.droppedFrames,
                avgBatchingEfficiency: this.calculateAverage(this.metrics.render.batchingEfficiency)
            }
        };
    }
    
    calculateAverageQueueDepth() {
        const depths = this.metrics.queue.queueDepthHistory.map(entry => entry.depth);
        return this.calculateAverage(depths);
    }
    
    calculateAverage(array) {
        if (array.length === 0) return 0;
        return array.reduce((a, b) => a + b, 0) / array.length;
    }
    
    reportPerformanceWarning(category, duration) {
        if (!this.enabled) return;
        
        const target = category === 'queue' ? 
            this.config.performanceTargets.queueOverhead :
            this.config.performanceTargets.gpuCommandSubmission;
            
        console.warn(`⚠️ Performance warning: ${category} operation took ${duration.toFixed(2)}ms (target: ${target}ms)`);
    }
    
    // Real-time monitoring methods
    getBottlenecks() {
        if (!this.enabled) return [];
        
        const bottlenecks = [];
        const summary = this.getPerformanceSummary();
        
        if (summary.queue.avgProcessingTime > this.config.performanceTargets.queueOverhead) {
            bottlenecks.push({
                type: 'queue',
                severity: 'high',
                description: `Queue processing time (${summary.queue.avgProcessingTime.toFixed(2)}ms) exceeds target`
            });
        }
        
        if (summary.render.averageFPS < 55) {
            bottlenecks.push({
                type: 'render',
                severity: 'medium', 
                description: `Low FPS detected (${summary.render.averageFPS.toFixed(1)})`
            });
        }
        
        if (summary.resources.activeLeaks > 10) {
            bottlenecks.push({
                type: 'memory',
                severity: 'high',
                description: `${summary.resources.activeLeaks} potential memory leaks detected`
            });
        }
        
        return bottlenecks;
    }
    
    exportMetrics() {
        if (!this.enabled) return null;
        
        return {
            timestamp: performance.now(),
            uptime: performance.now() - this.startTime,
            config: this.config,
            metrics: this.metrics,
            summary: this.getPerformanceSummary(),
            bottlenecks: this.getBottlenecks()
        };
    }
    
    dispose() {
        if (this.fpsInterval) {
            clearInterval(this.fpsInterval);
        }
        if (this.leakCheckInterval) {
            clearInterval(this.leakCheckInterval);
        }
    }
}

// Singleton instance
let performanceTracker = null;

export const getPerformanceTracker = () => {
    if (!performanceTracker) {
        performanceTracker = new PerformanceTracker();
    }
    return performanceTracker;
};

export { PerformanceTracker };
