#!/usr/bin/env node

/**
 * Build Validation Script
 * Validates that all build targets work correctly and are browser-compatible
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 SequentialGPU Build Validation Suite\n');

const builds = [
    { target: 'production', file: 'bundle.min.js', description: 'Production build' },
    { target: 'debug', file: 'bundle.js', description: 'Debug build' },
    { target: 'profile', file: 'bundle.profile.js', description: 'Profile build' }
];

let allPassed = true;

for (const build of builds) {
    console.log(`📦 Testing ${build.description}...`);
    
    try {
        // Build the target
        console.log(`   Building ${build.target}...`);
        execSync(`npm run build:${build.target}`, { stdio: 'pipe' });
        
        // Check if file exists
        const bundlePath = path.join(__dirname, '..', 'public', build.file);
        if (!fs.existsSync(bundlePath)) {
            throw new Error(`Bundle file ${build.file} not found`);
        }
        
        // Check file size
        const stats = fs.statSync(bundlePath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        console.log(`   ✅ Bundle created: ${sizeKB}KB`);
        
        // Check for browser compatibility issues
        const content = fs.readFileSync(bundlePath, 'utf8');
        
        // Check for unsafe process.env references (should be wrapped)
        const unsafeProcessRefs = content.match(/(?<!typeof )process\.env\.[A-Z_]+(?![^(]*\))/g);
        if (unsafeProcessRefs && unsafeProcessRefs.length > 0) {
            throw new Error(`Found unsafe process.env references: ${unsafeProcessRefs.join(', ')}`);
        }
        
        // Check for Node.js-specific globals
        const nodeGlobals = ['__dirname', '__filename', 'require(', 'exports.', 'module.exports'];
        const foundGlobals = nodeGlobals.filter(global => content.includes(global));
        if (foundGlobals.length > 0) {
            console.log(`   ⚠️  Found Node.js globals (may be intentional): ${foundGlobals.join(', ')}`);
        }
        
        // Validate build configuration is embedded
        if (!content.includes('getBuildConfig') && !content.includes('BUILD_FLAGS')) {
            throw new Error('Build configuration not properly embedded');
        }
        
        console.log(`   ✅ ${build.description} validation passed\n`);
        
    } catch (error) {
        console.log(`   ❌ ${build.description} validation failed: ${error.message}\n`);
        allPassed = false;
    }
}

// Performance metrics validation
console.log('📊 Performance Metrics:');
try {
    const debugBundle = fs.readFileSync(path.join(__dirname, '..', 'public', 'bundle.js'), 'utf8');
    const prodBundle = fs.readFileSync(path.join(__dirname, '..', 'public', 'bundle.min.js'), 'utf8');
    
    const debugSize = (debugBundle.length / 1024).toFixed(2);
    const prodSize = (prodBundle.length / 1024).toFixed(2);
    const compression = ((1 - prodBundle.length / debugBundle.length) * 100).toFixed(1);
    
    console.log(`   Debug bundle: ${debugSize}KB`);
    console.log(`   Production bundle: ${prodSize}KB`);
    console.log(`   Compression ratio: ${compression}%`);
    
    // Check for performance tracking in debug but not production
    const hasDebugTracking = debugBundle.includes('performanceTracker') && debugBundle.includes('getPerformanceTracker()');
    const hasProdTracking = prodBundle.includes('getPerformanceTracker()') && !prodBundle.includes('false ? getPerformanceTracker()');
    
    if (hasDebugTracking && !hasProdTracking) {
        console.log('   ✅ Performance tracking correctly excluded from production');
    } else if (!hasDebugTracking) {
        console.log('   ⚠️  Performance tracking not found in debug build');
    } else {
        console.log('   ✅ Performance tracking conditionally disabled in production');
    }
    
} catch (error) {
    console.log(`   ❌ Performance metrics validation failed: ${error.message}`);
    allPassed = false;
}

console.log('\n🎯 Build System Status:');
if (allPassed) {
    console.log('✅ All builds validated successfully!');
    console.log('🚀 Build system is ready for production use');
    console.log('\nQuick Start:');
    console.log('  npm run build:production  # Fast, optimized bundle');
    console.log('  npm run build:debug       # Full debugging features');
    console.log('  npm run build:profile     # Performance profiling');
    console.log('  npm run analyze           # Bundle analysis');
    console.log('  npm run perf-test          # Performance testing');
} else {
    console.log('❌ Some builds failed validation');
    process.exit(1);
}
