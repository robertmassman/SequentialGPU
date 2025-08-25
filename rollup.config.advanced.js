import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Build configuration plugin for conditional compilation
function buildConfigPlugin() {
    return {
        name: 'build-config',
        resolveId(id) {
            if (id === '../../build.config.js') {
                return id;
            }
            return null;
        },
        load(id) {
            if (id === '../../build.config.js') {
                const buildTarget = process.env.BUILD_TARGET || 'debug';
                const nodeEnv = process.env.NODE_ENV || 'development';
                
                // Generate the build config as a string that will work in the browser
                return `
/**
 * SequentialGPU Build Configuration (Generated at build time)
 */

export const BUILD_TARGETS = {
    PRODUCTION: 'production',
    DEBUG: 'debug', 
    PROFILE: 'profile'
};

export const getBuildConfig = () => {
    const config = {
        target: ${JSON.stringify(buildTarget)},
        isProduction: ${buildTarget === 'production'},
        isDebug: ${buildTarget === 'debug'},
        isProfile: ${buildTarget === 'profile'},
        
        // Performance settings
        enablePerformanceTracking: ${buildTarget !== 'production'},
        enableDebugLogging: ${buildTarget === 'debug'},
        enableAssertions: ${buildTarget === 'debug'},
        enableResourceTracking: ${buildTarget !== 'production'},
        enableVerboseErrors: ${buildTarget === 'debug'},
        
        // Optimization flags
        minifyCode: ${buildTarget === 'production'},
        treeShaking: true,
        stripDebugCode: ${buildTarget === 'production'},
        inlineConstants: ${buildTarget === 'production'},
        
        // Queue optimization settings
        queueOptimizations: {
            useObjectPooling: true,
            fastPathExecution: true,
            minimizeAllocations: ${buildTarget === 'production'},
            enableDetailedStats: ${buildTarget !== 'production'},
            debounceDelay: ${buildTarget === 'production' ? 0 : 1},
            maxPoolSize: ${buildTarget === 'production' ? 5 : 20}
        },
        
        // Performance targets (ms)
        performanceTargets: {
            queueOverhead: ${buildTarget === 'production' ? 5 : 10},
            maxFrameTime: 16.67, // 60 FPS
            gpuCommandSubmission: 2
        }
    };
    
    return config;
};

export const BUILD_FLAGS = {
    // Compile-time constants for conditional compilation
    __PRODUCTION__: ${buildTarget === 'production'},
    __DEBUG__: ${buildTarget === 'debug'},
    __PROFILE__: ${buildTarget === 'profile'},
    __DEV__: ${nodeEnv !== 'production'}
};
                `;
            }
            return null;
        },
        generateBundle(options, bundle) {
            // Replace any remaining process.env references with safe fallbacks
            const buildTarget = process.env.BUILD_TARGET || 'debug';
            const nodeEnv = process.env.NODE_ENV || 'development';
            const logLevel = process.env.LOG_LEVEL || 'debug';
            
            // Replace process.env references with safe browser-compatible code
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === 'chunk') {
                    // Replace process.env.LOG_LEVEL with a safe fallback
                    chunk.code = chunk.code.replace(
                        /process\.env\.LOG_LEVEL/g,
                        `(typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL) || ${JSON.stringify(logLevel)}`
                    );
                    
                    // Replace any other process.env.BUILD_TARGET references
                    chunk.code = chunk.code.replace(
                        /process\.env\.BUILD_TARGET/g,
                        JSON.stringify(buildTarget)
                    );
                    
                    // Replace any other process.env.NODE_ENV references
                    chunk.code = chunk.code.replace(
                        /process\.env\.NODE_ENV/g,
                        JSON.stringify(nodeEnv)
                    );
                }
            }
        }
    };
}

// Dead code elimination plugin for production builds
function deadCodeEliminationPlugin() {
    return {
        name: 'dead-code-elimination',
        generateBundle(options, bundle) {
            const isProduction = process.env.BUILD_TARGET === 'production';
            
            if (!isProduction) return;
            
            // Remove debug-only code in production
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === 'chunk') {
                    // Remove debug logging
                    chunk.code = chunk.code.replace(
                        /if\s*\([^)]*\.enableDebugLogging[^)]*\)\s*\{[^}]*console\.[^}]*\}/g,
                        ''
                    );
                    
                    // Remove performance tracking calls
                    chunk.code = chunk.code.replace(
                        /this\.performanceTracker\?\.[\w.()]*;?/g,
                        ''
                    );
                    
                    // Remove debug-only conditionals
                    chunk.code = chunk.code.replace(
                        /if\s*\([^)]*\.isProduction[^)]*\)\s*return[^;]*;/g,
                        ''
                    );
                }
            }
        }
    };
}

// Performance optimization plugin
function performanceOptimizationPlugin() {
    return {
        name: 'performance-optimization',
        generateBundle(options, bundle) {
            const isProduction = process.env.BUILD_TARGET === 'production';
            
            if (!isProduction) return;
            
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === 'chunk') {
                    // Inline small functions
                    chunk.code = chunk.code.replace(
                        /function\s+(\w+)\s*\(\s*\)\s*\{\s*return\s+([^;]+);\s*\}/g,
                        'const $1 = () => $2'
                    );
                    
                    // Optimize object property access patterns
                    chunk.code = chunk.code.replace(
                        /this\.config\.isProduction/g,
                        'true'
                    );
                    
                    chunk.code = chunk.code.replace(
                        /this\.config\.enablePerformanceTracking/g,
                        'false'
                    );
                }
            }
        }
    };
}

// Get build configuration based on environment
function getBuildConfig() {
    const buildTarget = process.env.BUILD_TARGET || 'debug';
    const nodeEnv = process.env.NODE_ENV || 'development';
    
    const configs = {
        production: {
            input: './src/index.js',
            output: {
                file: 'public/bundle.min.js',
                format: 'es',
                name: 'SequentialGPU',
                sourcemap: false,
                compact: true,
                inlineDynamicImports: true // Inline dynamic imports for single bundle
            },
            plugins: [
                resolve({ 
                    preferBuiltins: false,
                    browser: true 
                }),
                commonjs(),
                buildConfigPlugin(),
                deadCodeEliminationPlugin(),
                performanceOptimizationPlugin()
            ],
            treeshake: {
                moduleSideEffects: false,
                propertyReadSideEffects: false,
                unknownGlobalSideEffects: false
            }
        },
        
        debug: {
            input: './src/index.js',
            output: {
                file: 'public/bundle.js',
                format: 'es',
                name: 'SequentialGPU',
                sourcemap: true,
                inlineDynamicImports: true // Inline dynamic imports for single bundle
            },
            plugins: [
                resolve({ 
                    preferBuiltins: false,
                    browser: true 
                }),
                commonjs(),
                buildConfigPlugin()
            ],
            treeshake: false // Keep all code for debugging
        },
        
        profile: {
            input: './src/index.js',
            output: {
                file: 'public/bundle.profile.js',
                format: 'es',
                name: 'SequentialGPU',
                sourcemap: true,
                compact: false,
                inlineDynamicImports: true // Inline dynamic imports for single bundle
            },
            plugins: [
                resolve({ 
                    preferBuiltins: false,
                    browser: true 
                }),
                commonjs(),
                buildConfigPlugin(),
                // Keep essential performance tracking but remove verbose debug
                {
                    name: 'profile-optimization',
                    generateBundle(options, bundle) {
                        for (const chunk of Object.values(bundle)) {
                            if (chunk.type === 'chunk') {
                                // Remove verbose debug logging but keep performance metrics
                                chunk.code = chunk.code.replace(
                                    /console\.log\([^)]*debug[^)]*\);?/g,
                                    ''
                                );
                            }
                        }
                    }
                }
            ],
            treeshake: {
                moduleSideEffects: false
            }
        }
    };
    
    return configs[buildTarget] || configs.debug;
}

export default getBuildConfig();
