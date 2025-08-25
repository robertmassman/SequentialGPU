/**
 * SequentialGPU Build Configuration
 * Defines build targets and optimization settings
 */

export const BUILD_TARGETS = {
    PRODUCTION: 'production',
    DEBUG: 'debug', 
    PROFILE: 'profile'
};

export const getBuildConfig = () => {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const buildTarget = process.env.BUILD_TARGET || (nodeEnv === 'production' ? 'production' : 'debug');
    
    const config = {
        target: buildTarget,
        isProduction: buildTarget === BUILD_TARGETS.PRODUCTION,
        isDebug: buildTarget === BUILD_TARGETS.DEBUG,
        isProfile: buildTarget === BUILD_TARGETS.PROFILE,
        
        // Performance settings
        enablePerformanceTracking: buildTarget !== BUILD_TARGETS.PRODUCTION,
        enableDebugLogging: buildTarget === BUILD_TARGETS.DEBUG,
        enableAssertions: buildTarget === BUILD_TARGETS.DEBUG,
        enableResourceTracking: buildTarget !== BUILD_TARGETS.PRODUCTION,
        enableVerboseErrors: buildTarget === BUILD_TARGETS.DEBUG,
        
        // Optimization flags
        minifyCode: buildTarget === BUILD_TARGETS.PRODUCTION,
        treeShaking: true,
        stripDebugCode: buildTarget === BUILD_TARGETS.PRODUCTION,
        inlineConstants: buildTarget === BUILD_TARGETS.PRODUCTION,
        
        // Queue optimization settings
        queueOptimizations: {
            useObjectPooling: true,
            fastPathExecution: true,
            minimizeAllocations: buildTarget === BUILD_TARGETS.PRODUCTION,
            enableDetailedStats: buildTarget !== BUILD_TARGETS.PRODUCTION,
            debounceDelay: buildTarget === BUILD_TARGETS.PRODUCTION ? 0 : 1,
            maxPoolSize: buildTarget === BUILD_TARGETS.PRODUCTION ? 5 : 20
        },
        
        // Performance targets (ms)
        performanceTargets: {
            queueOverhead: buildTarget === BUILD_TARGETS.PRODUCTION ? 5 : 10,
            maxFrameTime: 16.67, // 60 FPS
            gpuCommandSubmission: 2
        }
    };
    
    return config;
};

export const BUILD_FLAGS = {
    // Compile-time constants for conditional compilation
    __PRODUCTION__: process.env.BUILD_TARGET === BUILD_TARGETS.PRODUCTION,
    __DEBUG__: process.env.BUILD_TARGET === BUILD_TARGETS.DEBUG,
    __PROFILE__: process.env.BUILD_TARGET === BUILD_TARGETS.PROFILE,
    __DEV__: process.env.NODE_ENV !== 'production'
};
