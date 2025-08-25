/**
 * SequentialGPU - WebGPU Image Processing Library
 * Main entry point for the library
 */

// Export the main library from sequentialgpu.js (which contains the conditional loading logic)
export { default } from './utils/sequentialgpu.js';

// Export additional utilities if needed for advanced usage
export { WebGpuRenderer } from './core/webGpuRenderer.js';
export { default as RenderQueue } from './queue/renderQueue.js';
export { default as SimpleTexturePool } from './memory/simpleTexturePool.js';
export { default as PipelineCacheManager } from './memory/pipelineCacheManager.js';
export { default as CommandQueueManager } from './queue/commandQueueManager.js';
