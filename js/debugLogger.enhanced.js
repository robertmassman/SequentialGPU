/**
 * Enhanced Debug Logger for SequentialGPU
 * Provides sophisticated logging with build-time optimization
 */

import { getBuildConfig } from '../build.config.js';
import { getPerformanceTracker } from './performanceTracker.js';

class DebugLogger {
    constructor() {
        this.config = getBuildConfig();
        this.performanceTracker = this.config.enablePerformanceTracking ? getPerformanceTracker() : null;
        
        // In production, become a no-op logger
        if (this.config.isProduction) {
            this.makeNoOp();
            return;
        }
        
        this.logLevel = this.getLogLevel();
        this.logHistory = [];
        this.maxHistorySize = 1000;
        this.logCategories = new Set();
        this.suppressedCategories = new Set();
        
        // Performance-related logging
        this.performanceLogs = [];
        this.bottleneckWarnings = new Map();
        
        // Resource tracking for leak detection
        this.resourceTracking = new Map();
        
        // Initialize console styles for different log levels
        this.initializeStyles();
        
        // Setup real-time performance monitoring
        if (this.config.isDebug) {
            this.setupPerformanceMonitoring();
        }
    }
    
    makeNoOp() {
        const noOp = () => {};
        const noOpReturn = (val) => val;
        
        // Convert all methods to no-ops for production
        Object.getOwnPropertyNames(DebugLogger.prototype)
            .filter(prop => prop !== 'constructor')
            .forEach(prop => {
                if (typeof this[prop] === 'function') {
                    this[prop] = prop.includes('get') || prop.includes('create') ? 
                        noOpReturn : noOp;
                }
            });
    }
    
    getLogLevel() {
        const levels = {
            'error': 0,
            'warn': 1,
            'info': 2,
            'debug': 3,
            'trace': 4
        };
        
        const envLevel = process.env.LOG_LEVEL || 'debug';
        return levels[envLevel] !== undefined ? levels[envLevel] : 3;
    }
    
    initializeStyles() {
        this.styles = {
            error: 'color: #ff4444; font-weight: bold;',
            warn: 'color: #ffaa00; font-weight: bold;',
            info: 'color: #4444ff;',
            debug: 'color: #888888;',
            trace: 'color: #666666; font-size: 11px;',
            performance: 'color: #ff6600; background: #fff3e0; padding: 2px 4px;',
            gpu: 'color: #00aa44; background: #e8f5e8; padding: 2px 4px;',
            queue: 'color: #aa0044; background: #f5e8e8; padding: 2px 4px;',
            resource: 'color: #6600aa; background: #f0e8f5; padding: 2px 4px;'
        };
    }
    
    setupPerformanceMonitoring() {
        // Monitor for performance bottlenecks
        this.performanceMonitor = setInterval(() => {
            if (this.performanceTracker) {
                const bottlenecks = this.performanceTracker.getBottlenecks();
                bottlenecks.forEach(bottleneck => {
                    this.logBottleneck(bottleneck);
                });
            }
        }, 5000);
        
        // Monitor queue depth
        this.queueMonitor = setInterval(() => {
            this.checkQueueHealth();
        }, 1000);
    }
    
    shouldLog(level, category = null) {
        if (this.config.isProduction) return false;
        
        const levelValue = typeof level === 'string' ? 
            ({ error: 0, warn: 1, info: 2, debug: 3, trace: 4 }[level] || 3) : level;
        
        if (levelValue > this.logLevel) return false;
        
        if (category && this.suppressedCategories.has(category)) return false;
        
        return true;
    }
    
    formatMessage(level, category, message, data = null) {
        const timestamp = new Date().toISOString();
        const categoryStr = category ? `[${category.toUpperCase()}]` : '';
        const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
        
        return {
            timestamp,
            level,
            category,
            message: `${timestamp} ${categoryStr} ${message}${dataStr}`,
            data
        };
    }
    
    addToHistory(logEntry) {
        this.logHistory.push(logEntry);
        if (this.logHistory.length > this.maxHistorySize) {
            this.logHistory.shift();
        }
        
        if (logEntry.category) {
            this.logCategories.add(logEntry.category);
        }
    }
    
    // Core logging methods
    error(message, data = null, category = 'general') {
        if (!this.shouldLog('error', category)) return;
        
        const logEntry = this.formatMessage('error', category, message, data);
        this.addToHistory(logEntry);
        
        console.error(`%c${logEntry.message}`, this.styles.error);
        
        // Track error for performance analysis
        if (this.performanceTracker && category === 'performance') {
            this.performanceTracker.recordPerformanceError(message, data);
        }
    }
    
    warn(message, data = null, category = 'general') {
        if (!this.shouldLog('warn', category)) return;
        
        const logEntry = this.formatMessage('warn', category, message, data);
        this.addToHistory(logEntry);
        
        console.warn(`%c${logEntry.message}`, this.styles.warn);
    }
    
    info(message, data = null, category = 'general') {
        if (!this.shouldLog('info', category)) return;
        
        const logEntry = this.formatMessage('info', category, message, data);
        this.addToHistory(logEntry);
        
        const style = this.styles[category] || this.styles.info;
        console.info(`%c${logEntry.message}`, style);
    }
    
    debug(message, data = null, category = 'general') {
        if (!this.shouldLog('debug', category)) return;
        
        const logEntry = this.formatMessage('debug', category, message, data);
        this.addToHistory(logEntry);
        
        const style = this.styles[category] || this.styles.debug;
        console.debug(`%c${logEntry.message}`, style);
    }
    
    trace(message, data = null, category = 'general') {
        if (!this.shouldLog('trace', category)) return;
        
        const logEntry = this.formatMessage('trace', category, message, data);
        this.addToHistory(logEntry);
        
        console.trace(`%c${logEntry.message}`, this.styles.trace);
    }
    
    // Specialized logging methods
    performance(message, timing = null, category = 'performance') {
        if (!this.config.enablePerformanceTracking) return;
        
        const timingStr = timing ? ` (${timing.toFixed(2)}ms)` : '';
        this.info(`⚡ ${message}${timingStr}`, timing, 'performance');
        
        if (timing) {
            this.performanceLogs.push({
                message,
                timing,
                timestamp: performance.now()
            });
            
            if (this.performanceLogs.length > 100) {
                this.performanceLogs.shift();
            }
        }
    }
    
    gpu(message, data = null) {
        this.debug(`🎮 ${message}`, data, 'gpu');
    }
    
    queue(message, queueState = null) {
        this.debug(`📋 ${message}`, queueState, 'queue');
    }
    
    resource(action, resourceType, resourceId, size = null) {
        const sizeStr = size ? ` (${size} bytes)` : '';
        this.debug(`🗂️ ${action} ${resourceType} ${resourceId}${sizeStr}`, null, 'resource');
        
        // Track resource for leak detection
        if (action === 'allocated') {
            this.resourceTracking.set(resourceId, {
                type: resourceType,
                size: size || 0,
                timestamp: performance.now()
            });
        } else if (action === 'released') {
            this.resourceTracking.delete(resourceId);
        }
    }
    
    bottleneck(type, severity, description, data = null) {
        const severityEmoji = {
            low: '🟡',
            medium: '🟠', 
            high: '🔴',
            critical: '💥'
        };
        
        const emoji = severityEmoji[severity] || '⚠️';
        this.warn(`${emoji} Bottleneck detected: ${description}`, data, 'performance');
        
        // Track bottleneck frequency
        const key = `${type}-${description}`;
        const existing = this.bottleneckWarnings.get(key) || { count: 0, lastSeen: 0 };
        existing.count++;
        existing.lastSeen = performance.now();
        this.bottleneckWarnings.set(key, existing);
    }
    
    logBottleneck(bottleneck) {
        this.bottleneck(
            bottleneck.type,
            bottleneck.severity,
            bottleneck.description,
            bottleneck.data
        );
    }
    
    checkQueueHealth() {
        // This would be called by queue monitoring
        // Implementation depends on queue state access
    }
    
    // Resource leak detection
    checkResourceLeaks() {
        if (!this.config.enableResourceTracking) return [];
        
        const now = performance.now();
        const leakThreshold = 60000; // 1 minute
        const leaks = [];
        
        for (const [resourceId, resource] of this.resourceTracking.entries()) {
            if (now - resource.timestamp > leakThreshold) {
                leaks.push({
                    resourceId,
                    type: resource.type,
                    age: now - resource.timestamp,
                    size: resource.size
                });
            }
        }
        
        if (leaks.length > 0) {
            this.warn(`Potential memory leaks detected: ${leaks.length} resources`, leaks, 'resource');
        }
        
        return leaks;
    }
    
    // Advanced debugging features
    createPerformanceReport() {
        if (!this.config.enablePerformanceTracking) return null;
        
        const recentPerformance = this.performanceLogs.slice(-50);
        const summary = this.performanceTracker ? this.performanceTracker.getPerformanceSummary() : null;
        
        return {
            recentOperations: recentPerformance,
            summary,
            bottlenecks: Array.from(this.bottleneckWarnings.entries()).map(([key, data]) => ({
                key,
                count: data.count,
                lastSeen: data.lastSeen
            })),
            resourceLeaks: this.checkResourceLeaks(),
            logStats: {
                totalLogs: this.logHistory.length,
                categories: Array.from(this.logCategories),
                errorCount: this.logHistory.filter(log => log.level === 'error').length
            }
        };
    }
    
    exportLogs(filter = null) {
        let logs = this.logHistory;
        
        if (filter) {
            logs = logs.filter(log => {
                if (filter.level && log.level !== filter.level) return false;
                if (filter.category && log.category !== filter.category) return false;
                if (filter.since && log.timestamp < filter.since) return false;
                return true;
            });
        }
        
        return {
            logs,
            exported: new Date().toISOString(),
            config: this.config,
            performanceReport: this.createPerformanceReport()
        };
    }
    
    // Real-time monitoring controls
    suppressCategory(category) {
        this.suppressedCategories.add(category);
        this.info(`Suppressed logging for category: ${category}`);
    }
    
    unsuppressCategory(category) {
        this.suppressedCategories.delete(category);
        this.info(`Resumed logging for category: ${category}`);
    }
    
    setLogLevel(level) {
        const levels = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
        if (levels[level] !== undefined) {
            this.logLevel = levels[level];
            this.info(`Log level set to: ${level}`);
        }
    }
    
    // Conditional logging macros for inline use
    logIf(condition, level, message, data = null, category = 'general') {
        if (condition) {
            this[level](message, data, category);
        }
    }
    
    logTiming(name, fn) {
        if (!this.config.enablePerformanceTracking) {
            return fn();
        }
        
        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;
        
        this.performance(`${name} completed`, duration);
        return result;
    }
    
    async logAsyncTiming(name, asyncFn) {
        if (!this.config.enablePerformanceTracking) {
            return await asyncFn();
        }
        
        const start = performance.now();
        const result = await asyncFn();
        const duration = performance.now() - start;
        
        this.performance(`${name} completed`, duration);
        return result;
    }
    
    dispose() {
        if (this.performanceMonitor) {
            clearInterval(this.performanceMonitor);
        }
        if (this.queueMonitor) {
            clearInterval(this.queueMonitor);
        }
    }
}

// Singleton instance
let debugLogger = null;

export const getDebugLogger = () => {
    if (!debugLogger) {
        debugLogger = new DebugLogger();
    }
    return debugLogger;
};

// Convenience macros for common usage patterns
export const debug = {
    log: (...args) => getDebugLogger().debug(...args),
    info: (...args) => getDebugLogger().info(...args),
    warn: (...args) => getDebugLogger().warn(...args),
    error: (...args) => getDebugLogger().error(...args),
    performance: (...args) => getDebugLogger().performance(...args),
    gpu: (...args) => getDebugLogger().gpu(...args),
    queue: (...args) => getDebugLogger().queue(...args),
    resource: (...args) => getDebugLogger().resource(...args),
    timing: (...args) => getDebugLogger().logTiming(...args),
    asyncTiming: (...args) => getDebugLogger().logAsyncTiming(...args)
};

export { DebugLogger };
