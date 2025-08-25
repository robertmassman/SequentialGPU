/**
 * Production-Optimized GPUUtils for SequentialGPU
 * High-performance utility functions with conditional debug features
 */

import { getBuildConfig } from '../build.config.js';
import { getPerformanceTracker } from './performanceTracker.js';
import { debug } from './debugLogger.enhanced.js';

class GPUUtils {
    static config = getBuildConfig();
    static performanceTracker = GPUUtils.config.enablePerformanceTracking ? getPerformanceTracker() : null;
    
    // Cached objects for production performance
    static _cachedSampler = null;
    static _layoutKeyCache = new Map();
    static _bindGroupEntryCache = new Map();
    
    /**
     * Production-optimized texture format validation
     */
    static validateTextureFormat(format) {
        if (GPUUtils.config.isProduction) {
            // In production, assume valid formats for performance
            return true;
        }
        
        const validFormats = [
            'r8unorm', 'r8snorm', 'r8uint', 'r8sint',
            'r16uint', 'r16sint', 'r16float',
            'rg8unorm', 'rg8snorm', 'rg8uint', 'rg8sint',
            'r32float', 'r32uint', 'r32sint',
            'rg16uint', 'rg16sint', 'rg16float',
            'rgba8unorm', 'rgba8unorm-srgb', 'rgba8snorm', 'rgba8uint', 'rgba8sint',
            'bgra8unorm', 'bgra8unorm-srgb',
            'rgb10a2unorm', 'rg11b10ufloat',
            'rg32uint', 'rg32sint', 'rg32float',
            'rgba16uint', 'rgba16sint', 'rgba16float',
            'rgba32uint', 'rgba32sint', 'rgba32float'
        ];
        
        const isValid = validFormats.includes(format);
        if (!isValid && GPUUtils.config.enableDebugLogging) {
            debug.warn(`Invalid texture format: ${format}`, null, 'gpu');
        }
        
        return isValid;
    }
    
    /**
     * Highly optimized buffer size calculation with alignment
     */
    static calculateAlignedBufferSize(size, alignment = 16) {
        // Production fast path - direct bit manipulation
        if (GPUUtils.config.isProduction) {
            return (size + alignment - 1) & ~(alignment - 1);
        }
        
        // Debug path with validation
        if (size <= 0) {
            debug.warn(`Invalid buffer size: ${size}`, null, 'gpu');
            return alignment;
        }
        
        if (alignment <= 0 || (alignment & (alignment - 1)) !== 0) {
            debug.warn(`Invalid alignment: ${alignment}, using 16`, null, 'gpu');
            alignment = 16;
        }
        
        const alignedSize = (size + alignment - 1) & ~(alignment - 1);
        
        if (GPUUtils.config.enablePerformanceTracking) {
            debug.trace(`Buffer size aligned: ${size} -> ${alignedSize} (alignment: ${alignment})`, null, 'gpu');
        }
        
        return alignedSize;
    }
    
    /**
     * Production-optimized tracked buffer creation
     */
    static createTrackedBuffer(device, descriptor, resourceTracker = null) {
        let perfContext = null;
        if (GPUUtils.performanceTracker) {
            perfContext = GPUUtils.performanceTracker.startGPUCommand('buffer-create');
        }
        
        try {
            const buffer = device.createBuffer(descriptor);
            
            // Resource tracking (debug only)
            if (!GPUUtils.config.isProduction && resourceTracker) {
                resourceTracker.add(buffer);
                debug.resource('allocated', 'buffer', buffer.label || 'unnamed', descriptor.size);
                
                if (GPUUtils.performanceTracker) {
                    GPUUtils.performanceTracker.recordResourceAllocation('buffer', descriptor.size, buffer);
                }
            }
            
            if (perfContext && GPUUtils.performanceTracker) {
                GPUUtils.performanceTracker.endGPUCommand(perfContext);
            }
            return buffer;
            
        } catch (error) {
            if (perfContext && GPUUtils.performanceTracker) {
                GPUUtils.performanceTracker.endGPUCommand(perfContext);
            }
            throw GPUUtils.handleError('GPUUtils', 'createTrackedBuffer', error, descriptor);
        }
    }
    
    /**
     * Production-optimized shader error formatting
     */
    static formatShaderErrors(errors, code, label) {
        if (GPUUtils.config.isProduction) {
            // Minimal error info in production
            return {
                summary: errors.length > 0 ? 'Shader compilation failed' : '',
                errorCount: errors.length,
                label
            };
        }
        
        // Full debug formatting
        const lines = code.split('\n');
        const formattedErrors = errors.map(error => GPUUtils.formatShaderMessage(error, lines));
        
        const errorInfo = {
            summary: errors.map(e => e.message).join('\n'),
            details: formattedErrors,
            errorCount: errors.length,
            label,
            sourceLines: lines.length
        };
        
        if (GPUUtils.config.enableDebugLogging) {
            debug.error(`Shader compilation failed for ${label}`, errorInfo, 'gpu');
        }
        
        return errorInfo;
    }
    
    /**
     * Production-optimized shader message formatting
     */
    static formatShaderMessage(message, codeLines = []) {
        if (GPUUtils.config.isProduction) {
            return message.message || 'Compilation error';
        }
        
        const { lineNum, linePos, offset, length, message: msg, type } = message;
        let formattedMsg = `[${type?.toUpperCase() || 'ERROR'}] Line ${lineNum || 0}:${linePos || 0} - ${msg}`;
        
        // Add code context in debug mode
        if (codeLines.length > 0 && lineNum > 0 && lineNum <= codeLines.length) {
            const line = codeLines[lineNum - 1];
            const pointer = ' '.repeat(Math.max(0, (linePos || 1) - 1)) + '^'.repeat(Math.max(1, length || 1));
            formattedMsg += `\n${line}\n${pointer}`;
        }
        
        return formattedMsg;
    }
    
    /**
     * Optimized bind group layout compatibility check
     */
    static areLayoutsCompatible(layout1, layout2) {
        if (GPUUtils.config.isProduction) {
            // Simplified check in production
            return layout1 === layout2;
        }
        
        if (!layout1 || !layout2) return false;
        if (layout1 === layout2) return true;
        
        // Deep comparison for debug builds
        try {
            const entries1 = layout1.entries || [];
            const entries2 = layout2.entries || [];
            
            if (entries1.length !== entries2.length) return false;
            
            return entries1.every((entry1, index) => {
                const entry2 = entries2[index];
                return (
                    entry1.binding === entry2.binding &&
                    entry1.visibility === entry2.visibility &&
                    JSON.stringify(entry1.buffer) === JSON.stringify(entry2.buffer) &&
                    JSON.stringify(entry1.texture) === JSON.stringify(entry2.texture) &&
                    JSON.stringify(entry1.sampler) === JSON.stringify(entry2.sampler)
                );
            });
        } catch (error) {
            debug.warn('Layout compatibility check failed', error, 'gpu');
            return false;
        }
    }
    
    /**
     * Production-optimized resource destruction
     */
    static safeDestroy(resource, resourceType = 'resource') {
        if (!resource) return;
        
        try {
            if (typeof resource.destroy === 'function') {
                resource.destroy();
                
                if (!GPUUtils.config.isProduction) {
                    debug.resource('released', resourceType, resource.label || 'unnamed');
                    
                    if (GPUUtils.performanceTracker) {
                        GPUUtils.performanceTracker.recordResourceRelease(resource);
                    }
                }
            }
        } catch (error) {
            if (GPUUtils.config.enableDebugLogging) {
                debug.warn(`Failed to destroy ${resourceType}`, error, 'gpu');
            }
        }
    }
    
    /**
     * Optimized standard sampler creation with caching
     */
    static createStandardSampler(device) {
        // Cache sampler in production for performance
        if (GPUUtils.config.isProduction && GPUUtils._cachedSampler) {
            return GPUUtils._cachedSampler;
        }
        
        const sampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
        });
        
        if (GPUUtils.config.isProduction) {
            GPUUtils._cachedSampler = sampler;
        }
        
        return sampler;
    }
    
    /**
     * Optimized bind group layout key generation with caching
     */
    static generateBindGroupLayoutKey(filter, pass) {
        // Production optimization: use cached keys
        const cacheKey = `${filter.type}-${pass.inputTexture?.length || 0}-${!!filter.bufferAttachment?.bindings}`;
        
        if (GPUUtils.config.isProduction && GPUUtils._layoutKeyCache.has(cacheKey)) {
            return GPUUtils._layoutKeyCache.get(cacheKey);
        }
        
        const keyComponents = {
            type: filter.type,
            inputTextureCount: pass.inputTexture?.length || 0,
            hasBuffer: !!filter.bufferAttachment?.bindings,
            bufferType: filter.type === 'compute' ? 'storage' : 'uniform',
            bindingIndex: filter.bufferAttachment?.bindingIndex
        };
        
        const keyString = JSON.stringify(keyComponents);
        const hash = GPUUtils.hashString(keyString);
        
        if (GPUUtils.config.isProduction) {
            GPUUtils._layoutKeyCache.set(cacheKey, hash);
        }
        
        return hash;
    }
    
    /**
     * Optimized pipeline key generation
     */
    static generatePipelineKey(config) {
        const keyComponents = {
            type: config.type,
            shader: config.shaderURL,
            format: config.presentationFormat,
            sampleCount: config.sampleCount,
            
            // Simplified layout for production
            layoutSignature: GPUUtils.config.isProduction ? 
                `${config.bindGroupLayout?.length || 0}` :
                config.bindGroupLayout?.map(entry => ({
                    binding: entry.binding,
                    visibility: entry.visibility,
                    bufferType: entry.buffer?.type,
                    textureFormat: entry.texture?.format,
                    samplerType: entry.sampler?.type
                }))
        };
        
        if (config.type !== 'compute') {
            keyComponents.vertex = {
                entryPoint: 'vs',
                bufferCount: 2 // Standard vertex setup
            };
            keyComponents.fragment = {
                targets: [{ format: config.presentationFormat }],
                entryPoint: 'fs'
            };
            keyComponents.multisample = {
                count: config.sampleCount || 1
            };
        } else {
            keyComponents.compute = {
                entryPoint: 'main'
            };
        }
        
        return GPUUtils.hashString(JSON.stringify(keyComponents));
    }
    
    /**
     * Optimized standard layout entries creation
     */
    static createStandardLayoutEntries({ filter, pass }) {
        const cacheKey = `${filter.type}-${pass.inputTexture?.length || 0}-${!!filter.bufferAttachment?.bindings}`;
        
        if (GPUUtils.config.isProduction && GPUUtils._bindGroupEntryCache.has(cacheKey)) {
            return GPUUtils._bindGroupEntryCache.get(cacheKey);
        }
        
        const visibility = filter.type === 'compute' ? GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT;
        const entries = [];
        
        // Sampler binding
        entries.push({
            binding: 0,
            visibility,
            sampler: { type: 'filtering' }
        });
        
        // Texture bindings
        if (pass.inputTexture?.length) {
            for (let i = 0; i < pass.inputTexture.length; i++) {
                entries.push({
                    binding: i + 1,
                    visibility,
                    texture: { sampleType: 'float' }
                });
            }
        }
        
        // Buffer binding
        if (filter.bufferAttachment?.bindings) {
            entries.push({
                binding: filter.bufferAttachment.bindingIndex || 3,
                visibility,
                buffer: {
                    type: filter.type === 'compute' ? 'storage' : 'uniform'
                }
            });
        }
        
        if (GPUUtils.config.isProduction) {
            GPUUtils._bindGroupEntryCache.set(cacheKey, entries);
        }
        
        return entries;
    }
    
    /**
     * Optimized standard bind group entries creation
     */
    static createStandardBindGroupEntries({ device, textureManager, filter, pass, bufferResource }) {
        const entries = [];
        
        // Sampler entry
        entries.push({
            binding: 0,
            resource: GPUUtils.createStandardSampler(device)
        });
        
        // Texture entries
        if (pass.inputTexture?.length) {
            for (let i = 0; i < pass.inputTexture.length; i++) {
                const textureName = pass.inputTexture[i];
                const textureView = textureManager.getTexture(textureName)?.createView();
                
                if (!textureView) {
                    throw new Error(`Texture "${textureName}" not found`);
                }
                
                entries.push({
                    binding: i + 1,
                    resource: textureView
                });
            }
        }
        
        // Buffer entry
        if (filter.bufferAttachment?.bindings && bufferResource?.buffer) {
            entries.push({
                binding: filter.bufferAttachment.bindingIndex || 3,
                resource: {
                    buffer: bufferResource.buffer,
                    offset: 0,
                    size: bufferResource.buffer.size
                }
            });
        }
        
        return entries;
    }
    
    /**
     * Fast string hashing function
     */
    static hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }
    
    /**
     * Enhanced error handling with context
     */
    static handleError(source, method, error, context = null) {
        if (GPUUtils.config.isProduction) {
            // Minimal error handling in production
            return new Error(`${source}.${method} failed`);
        }
        
        const errorInfo = {
            source,
            method,
            originalError: error.message,
            context,
            timestamp: new Date().toISOString()
        };
        
        debug.error(`${source}.${method} failed`, errorInfo, 'gpu');
        
        const enhancedError = new Error(`${source}.${method}: ${error.message}`);
        enhancedError.context = errorInfo;
        
        return enhancedError;
    }
    
    /**
     * Performance-optimized debounce (production: immediate execution)
     */
    static debounce(func, delay) {
        if (GPUUtils.config.isProduction) {
            // Immediate execution in production for performance
            return func;
        }
        
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }
    
    /**
     * Conditional assertions for debug builds only
     */
    static assert(condition, message) {
        if (!GPUUtils.config.enableAssertions) return;
        
        if (!condition) {
            const assertionError = new Error(`Assertion failed: ${message}`);
            debug.error('Assertion failed', { message, stack: assertionError.stack }, 'gpu');
            throw assertionError;
        }
    }
    
    /**
     * Cache management for production optimization
     */
    static clearCaches() {
        GPUUtils._layoutKeyCache.clear();
        GPUUtils._bindGroupEntryCache.clear();
        GPUUtils._cachedSampler = null;
        
        if (!GPUUtils.config.isProduction) {
            debug.info('GPUUtils caches cleared', null, 'gpu');
        }
    }
    
    /**
     * Get cache statistics (debug only)
     */
    static getCacheStats() {
        if (GPUUtils.config.isProduction) {
            return { message: 'Cache stats unavailable in production' };
        }
        
        return {
            layoutKeyCache: {
                size: GPUUtils._layoutKeyCache.size,
                keys: Array.from(GPUUtils._layoutKeyCache.keys())
            },
            bindGroupEntryCache: {
                size: GPUUtils._bindGroupEntryCache.size,
                keys: Array.from(GPUUtils._bindGroupEntryCache.keys())
            },
            hasCachedSampler: !!GPUUtils._cachedSampler
        };
    }
}

export { GPUUtils };
