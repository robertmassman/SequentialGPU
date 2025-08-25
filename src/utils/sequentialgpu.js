
/**
 * SequentialGPU Main Entry Point
 * Conditional loading based on build target for optimal performance
 */

import { getBuildConfig } from '../../build.config.js';
import { WebGpuRenderer } from '../core/webGpuRenderer.js';
import { RenderQueue } from '../queue/renderQueue.optimized.js';

// Build configuration
const config = getBuildConfig();

// Helper functions for no-op implementations
function createNoOpLogger() {
    return new Proxy({}, { 
        get: () => () => {} 
    });
}

function createNoOpPerformanceTracker() {
    return new Proxy({}, { 
        get: () => () => {} 
    });
}

// Async function to load debug modules
async function loadDebugModules() {
    if (config.isProduction) {
        return {
            debugLogger: createNoOpLogger(),
            performanceTracker: createNoOpPerformanceTracker()
        };
    }
    
    try {
        const [debugModule, perfModule] = await Promise.all([
            import('./debugLogger.enhanced.js'),
            import('./performanceTracker.js')
        ]);
        
        return {
            debugLogger: debugModule.getDebugLogger(),
            performanceTracker: perfModule.getPerformanceTracker()
        };
    } catch (error) {
        console.warn('Debug modules failed to load, using no-op implementations');
        return {
            debugLogger: createNoOpLogger(),
            performanceTracker: createNoOpPerformanceTracker()
        };
    }
}

export const SequentialGPU = {
    /**
     * Create a new SequentialGPU application instance
     * @param {Object} settings - Application configuration
     * @returns {Promise<WebGpuRenderer>} Initialized renderer instance
     */
    async createApp(settings) {
        // Initialize debug tools based on build target
        let debug, performance;
        
        if (config.isProduction) {
            // Production: Use no-op implementations directly without loading modules
            debug = createNoOpLogger();
            performance = createNoOpPerformanceTracker();
        } else {
            // Development: Load actual debug modules
            const { debugLogger, performanceTracker } = await loadDebugModules();
            debug = debugLogger;
            performance = performanceTracker;
        }
        
        // Log initialization based on build type
        if (!config.isProduction) {
            debug.info('Initializing SequentialGPU', {
                buildTarget: config.target,
                settings: settings,
                optimizations: config.queueOptimizations
            }, 'system');
        }
        
        // Start performance tracking
        const initContext = performance.startAsyncOperation?.();
        
        try {
            const webGpuRenderer = new WebGpuRenderer({
                ...settings,
                buildConfig: config,
                debugLogger: debug,
                performanceTracker: performance
            });
            
            await webGpuRenderer.initialize();
            
            // End performance tracking
            performance.endAsyncOperation?.(initContext);
            
            if (!config.isProduction) {
                debug.info('SequentialGPU initialized successfully', {
                    renderer: webGpuRenderer.constructor.name,
                    features: this.getFeatureSummary()
                }, 'system');
            }
            
            return webGpuRenderer;
            
        } catch (error) {
            performance.endAsyncOperation?.(initContext);
            
            if (!config.isProduction) {
                debug.error('SequentialGPU initialization failed', error, 'system');
            }
            
            throw error;
        }
    },
    
    /**
     * Get build and feature information
     * @returns {Object} Build configuration and available features
     */
    getBuildInfo() {
        return {
            target: config.target,
            version: '0.0.8',
            features: this.getFeatureSummary(),
            performance: {
                queueOptimizations: config.queueOptimizations,
                targets: config.performanceTargets
            },
            buildTime: new Date().toISOString()
        };
    },
    
    /**
     * Get available features based on build target
     * @returns {Object} Available features
     */
    getFeatureSummary() {
        return {
            debugging: config.enableDebugLogging,
            performanceTracking: config.enablePerformanceTracking,
            resourceTracking: config.enableResourceTracking,
            assertions: config.enableAssertions,
            verboseErrors: config.enableVerboseErrors,
            production: config.isProduction,
            optimized: {
                fastPath: true,
                objectPooling: config.queueOptimizations.useObjectPooling,
                caching: true,
                minimizedAllocations: config.queueOptimizations.minimizeAllocations
            }
        };
    },
    
    /**
     * Set global logging level (debug builds only)
     * @param {string} level - Log level (error, warn, info, debug, trace)
     */
    async setLogLevel(level) {
        if (config.isProduction) {
            return; // No-op in production
        }
        
        const { debugLogger } = await loadDebugModules();
        debugLogger.setLogLevel?.(level);
    },
    
    /**
     * Export performance report (debug builds only)
     * @returns {Object|null} Performance report or null in production
     */
    async exportPerformanceReport() {
        if (config.isProduction) {
            return null;
        }
        
        const { debugLogger, performanceTracker } = await loadDebugModules();
        
        return {
            performance: performanceTracker.exportMetrics?.(),
            logs: debugLogger.exportLogs?.(),
            buildInfo: this.getBuildInfo()
        };
    },
    
    /**
     * Clear all caches and reset state (debug builds only)
     */
    async resetState() {
        if (config.isProduction) {
            return; // No-op in production
        }
        
        const { debugLogger } = await loadDebugModules();
        debugLogger.info('Resetting SequentialGPU state', null, 'system');
        
        // Clear various caches if available
        if (typeof GPUUtils !== 'undefined') {
            GPUUtils.clearCaches?.();
        }
    }
};

// Legacy compatibility
export default SequentialGPU;

// Export build configuration for external access
export const buildConfig = config;

// Export conditional classes for advanced usage
export {
    WebGpuRenderer,
    RenderQueue,
    loadDebugModules
};