#!/usr/bin/env node

/**
 * Bundle Analysis Script for SequentialGPU
 * Analyzes bundle size, tree-shaking effectiveness, and performance optimizations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

class BundleAnalyzer {
    constructor() {
        this.results = {
            bundles: {},
            comparisons: {},
            optimization: {},
            recommendations: []
        };
    }
    
    async analyzeBundles() {
        console.log('🔍 Analyzing SequentialGPU bundles...\n');
        
        const bundleFiles = [
            { name: 'production', path: 'public/bundle.min.js', target: 'production' },
            { name: 'debug', path: 'public/bundle.js', target: 'debug' },
            { name: 'profile', path: 'public/bundle.profile.js', target: 'profile' }
        ];
        
        for (const bundle of bundleFiles) {
            const bundlePath = path.join(projectRoot, bundle.path);
            if (fs.existsSync(bundlePath)) {
                await this.analyzeBundle(bundle, bundlePath);
            } else {
                console.log(`⚠️  Bundle not found: ${bundle.path}`);
            }
        }
        
        this.compareBuilds();
        this.analyzeOptimizations();
        this.generateRecommendations();
        this.displayResults();
    }
    
    async analyzeBundle(bundleInfo, bundlePath) {
        const content = fs.readFileSync(bundlePath, 'utf8');
        const stats = fs.statSync(bundlePath);
        
        const analysis = {
            name: bundleInfo.name,
            target: bundleInfo.target,
            size: {
                bytes: stats.size,
                kb: Math.round(stats.size / 1024 * 100) / 100,
                mb: Math.round(stats.size / (1024 * 1024) * 100) / 100
            },
            lines: content.split('\n').length,
            minified: this.isMinified(content),
            features: this.analyzeFeatures(content),
            performance: this.analyzePerformanceCode(content),
            treeshaking: this.analyzeTreeShaking(content),
            compression: await this.estimateCompression(content)
        };
        
        this.results.bundles[bundleInfo.name] = analysis;
        
        console.log(`📦 ${bundleInfo.name.toUpperCase()} Bundle:`);
        console.log(`   Size: ${analysis.size.kb} KB (${analysis.size.bytes} bytes)`);
        console.log(`   Lines: ${analysis.lines.toLocaleString()}`);
        console.log(`   Minified: ${analysis.minified ? '✅' : '❌'}`);
        console.log(`   Debug code: ${analysis.features.hasDebugCode ? '❌' : '✅'}`);
        console.log(`   Performance tracking: ${analysis.features.hasPerformanceTracking ? '❌' : '✅'}`);
        console.log('');
    }
    
    isMinified(content) {
        const lines = content.split('\n');
        const avgLineLength = content.length / lines.length;
        return avgLineLength > 100; // Heuristic for minification
    }
    
    analyzeFeatures(content) {
        return {
            hasDebugCode: /console\.(log|debug|trace)/g.test(content),
            hasPerformanceTracking: /performanceTracker/g.test(content),
            hasAssertions: /assert\(/g.test(content),
            hasVerboseErrors: /formatShaderErrors.*details/g.test(content),
            hasResourceTracking: /resourceTracking/g.test(content),
            hasDetailedStats: /getPerformanceSummary/g.test(content),
            
            // Count occurrences
            debugLogCount: (content.match(/console\.(log|debug|trace)/g) || []).length,
            performanceCallCount: (content.match(/performanceTracker\./g) || []).length,
            conditionalChecks: (content.match(/config\.isProduction/g) || []).length
        };
    }
    
    analyzePerformanceCode(content) {
        return {
            fastPathOptimizations: /executeImmediate|fastPath/g.test(content),
            objectPooling: /wrapperPool|returnWrapperToPool/g.test(content),
            caching: /_cached|Cache\.get|Cache\.set/g.test(content),
            inlineOptimizations: /inline|direct/gi.test(content),
            
            // Performance-critical patterns
            asyncChains: (content.match(/await\s+\w+\(/g) || []).length,
            promiseCreations: (content.match(/new Promise\(/g) || []).length,
            mapOperations: (content.match(/\.map\(/g) || []).length,
            forLoops: (content.match(/for\s*\(/g) || []).length
        };
    }
    
    analyzeTreeShaking(content) {
        // Analyze what code was successfully tree-shaken
        const deadCodePatterns = [
            { name: 'unused imports', pattern: /import.*from.*unused/g },
            { name: 'unreachable code', pattern: /\/\*.*unused.*\*\//g },
            { name: 'debug blocks', pattern: /if\s*\(.*debug.*\)\s*\{[^}]*\}/g },
            { name: 'commented code', pattern: /\/\*[\s\S]*?\*\//g }
        ];
        
        const analysis = {};
        deadCodePatterns.forEach(pattern => {
            const matches = content.match(pattern.pattern) || [];
            analysis[pattern.name] = matches.length;
        });
        
        return analysis;
    }
    
    async estimateCompression(content) {
        // Estimate gzip compression ratio
        const repetitivePatterns = [
            /this\./g,
            /function/g,
            /const /g,
            /return /g
        ];
        
        let compressionScore = 100;
        repetitivePatterns.forEach(pattern => {
            const matches = content.match(pattern) || [];
            compressionScore -= matches.length * 0.001; // Rough heuristic
        });
        
        return {
            estimatedGzipRatio: Math.max(20, Math.min(80, compressionScore)),
            repetitivePatterns: repetitivePatterns.map(p => (content.match(p) || []).length)
        };
    }
    
    compareBuilds() {
        const production = this.results.bundles.production;
        const debug = this.results.bundles.debug;
        const profile = this.results.bundles.profile;
        
        if (!production || !debug) return;
        
        this.results.comparisons = {
            sizeReduction: {
                debugToProduction: this.calculateReduction(debug.size.bytes, production.size.bytes),
                profileToProduction: profile ? this.calculateReduction(profile.size.bytes, production.size.bytes) : null
            },
            featureElimination: {
                debugCodeRemoved: debug.features.hasDebugCode && !production.features.hasDebugCode,
                performanceTrackingRemoved: debug.features.hasPerformanceTracking && !production.features.hasPerformanceTracking,
                assertionsRemoved: debug.features.hasAssertions && !production.features.hasAssertions
            },
            optimizationEffectiveness: {
                conditionalChecksReduced: debug.features.conditionalChecks - production.features.conditionalChecks,
                debugCallsRemoved: debug.features.debugLogCount - production.features.debugLogCount,
                performanceCallsRemoved: debug.features.performanceCallCount - production.features.performanceCallCount
            }
        };
    }
    
    calculateReduction(original, optimized) {
        const reduction = ((original - optimized) / original) * 100;
        return {
            bytes: original - optimized,
            percentage: Math.round(reduction * 100) / 100,
            ratio: `${Math.round(optimized / original * 100)}% of original`
        };
    }
    
    analyzeOptimizations() {
        const production = this.results.bundles.production;
        const debug = this.results.bundles.debug;
        
        if (!production || !debug) return;
        
        this.results.optimization = {
            bundleSize: production.size.kb < 500 ? 'excellent' : production.size.kb < 1000 ? 'good' : 'needs improvement',
            minification: production.minified ? 'active' : 'missing',
            treeShaking: this.results.comparisons.sizeReduction.debugToProduction.percentage > 30 ? 'effective' : 'ineffective',
            deadCodeElimination: production.features.debugLogCount === 0 ? 'complete' : 'partial',
            
            performanceOptimizations: {
                fastPath: production.performance.fastPathOptimizations,
                objectPooling: production.performance.objectPooling,
                caching: production.performance.caching
            }
        };
    }
    
    generateRecommendations() {
        const production = this.results.bundles.production;
        const debug = this.results.bundles.debug;
        
        // Size recommendations
        if (production?.size.kb > 500) {
            this.results.recommendations.push({
                type: 'size',
                priority: 'high',
                message: `Production bundle is ${production.size.kb}KB. Consider further optimization.`,
                suggestions: [
                    'Enable more aggressive tree-shaking',
                    'Remove unused dependencies',
                    'Use dynamic imports for non-critical code'
                ]
            });
        }
        
        // Optimization recommendations
        if (production?.features.debugLogCount > 0) {
            this.results.recommendations.push({
                type: 'optimization',
                priority: 'medium',
                message: `${production.features.debugLogCount} debug calls found in production build`,
                suggestions: [
                    'Improve dead code elimination',
                    'Add more aggressive debug code removal',
                    'Use conditional compilation flags'
                ]
            });
        }
        
        // Performance recommendations
        if (!production?.performance.fastPathOptimizations) {
            this.results.recommendations.push({
                type: 'performance',
                priority: 'high',
                message: 'Fast path optimizations not detected in production build',
                suggestions: [
                    'Implement fast-path execution for common operations',
                    'Add object pooling for frequently created objects',
                    'Cache expensive computations'
                ]
            });
        }
        
        // Build process recommendations
        if (this.results.comparisons.sizeReduction?.debugToProduction.percentage < 20) {
            this.results.recommendations.push({
                type: 'build',
                priority: 'medium',
                message: 'Low size reduction between debug and production builds',
                suggestions: [
                    'Review build configuration for better optimization',
                    'Ensure debug code is properly marked for elimination',
                    'Consider using more aggressive minification settings'
                ]
            });
        }
    }
    
    displayResults() {
        console.log('\n📊 BUILD ANALYSIS SUMMARY\n');
        
        // Size comparison
        if (this.results.comparisons.sizeReduction) {
            const reduction = this.results.comparisons.sizeReduction.debugToProduction;
            console.log('💾 Size Analysis:');
            console.log(`   Debug → Production: ${reduction.bytes} bytes saved (${reduction.percentage}% reduction)`);
            console.log(`   Production bundle: ${reduction.ratio}\n`);
        }
        
        // Optimization effectiveness
        console.log('⚡ Optimization Effectiveness:');
        Object.entries(this.results.optimization).forEach(([key, value]) => {
            if (typeof value === 'string') {
                const emoji = value === 'excellent' || value === 'complete' || value === 'active' ? '✅' : 
                             value === 'good' || value === 'effective' || value === 'partial' ? '⚠️' : '❌';
                console.log(`   ${key}: ${emoji} ${value}`);
            }
        });
        
        // Performance features
        if (this.results.optimization.performanceOptimizations) {
            console.log('\n🚀 Performance Features:');
            Object.entries(this.results.optimization.performanceOptimizations).forEach(([key, value]) => {
                console.log(`   ${key}: ${value ? '✅' : '❌'}`);
            });
        }
        
        // Recommendations
        if (this.results.recommendations.length > 0) {
            console.log('\n💡 Recommendations:');
            this.results.recommendations.forEach((rec, index) => {
                const priorityEmoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
                console.log(`   ${index + 1}. ${priorityEmoji} [${rec.type.toUpperCase()}] ${rec.message}`);
                
                if (rec.suggestions) {
                    rec.suggestions.forEach(suggestion => {
                        console.log(`      • ${suggestion}`);
                    });
                }
                console.log('');
            });
        }
        
        // Performance targets
        console.log('🎯 Performance Targets:');
        const production = this.results.bundles.production;
        if (production) {
            console.log(`   Bundle size: ${production.size.kb < 500 ? '✅' : '❌'} Target: <500KB (Current: ${production.size.kb}KB)`);
            console.log(`   Minification: ${production.minified ? '✅' : '❌'} Target: Active`);
            console.log(`   Debug code: ${production.features.debugLogCount === 0 ? '✅' : '❌'} Target: 0 debug calls`);
        }
        
        console.log('\n✨ Analysis complete!\n');
    }
    
    exportReport() {
        const reportPath = path.join(projectRoot, 'build-analysis-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
        console.log(`📄 Detailed report saved to: ${reportPath}`);
    }
}

// Run analysis
const analyzer = new BundleAnalyzer();
analyzer.analyzeBundles().then(() => {
    analyzer.exportReport();
}).catch(error => {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
});
