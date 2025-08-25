# SequentialGPU

[![npm version](https://img.shields.io/npm/v/sequentialgpu.svg)](https://www.npmjs.com/package/sequentialgpu)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A WebGPU image processing implementation for rendering filters and their passes in sequence.

## Introduction

SequentialGPU provides a powerful, flexible framework for GPU-accelerated image processing using the WebGPU API. It offers:

- **Sequential Filter Processing** - Apply multiple filters in sequence with multi-pass support
- **Multiple Shader Types** - Support for both fragment and compute shaders
- **Dynamic Buffer Management** - Easy updating of filter parameters at runtime
- **Flexible Texture Handling** - Create and manage multiple input/output textures
- **MSAA Support** - Multi-sample anti-aliasing for high-quality rendering
- **Advanced Performance Optimization** - Object pooling, pipeline caching, and queue management
- **Real-time Performance Monitoring** - Built-in benchmarking and analytics
- **Memory Management** - Automatic texture pooling and resource cleanup

## Requirements

- Modern browser with WebGPU support (Chrome 113+, Edge 113+, or Firefox with flags)
- For development: Node.js 18+ and npm

**WebGPU Browser Support:**
- Chrome/Edge 113+ (stable support)
- Firefox: Enable `dom.webgpu.enabled` flag
- Safari: Experimental support in Safari Technology Preview

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Render Queue System](#render-queue-system)
- [Performance Features](#performance-features)
- [API](#api)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Installation

To install the package, use npm:

```sh
npm install sequentialgpu
```

## Usage

The `SequentialGPU` module provides a `WebGpuRenderer` class that initializes WebGPU processing with the given settings. The settings object should contain the following properties:


```js
import SequentialGPU from 'sequentialgpu';

const settings = {
    images: ['path/to/image1.png', 'path/to/image2.png'], // Array of image paths
    presentationFormat: 'rgba8unorm',
    textures: {
      textureIN: {
         label: 'optional',
         notes: 'optional',
         format: 'optional',
         usage: 'optional',
         sampleCount: 'optional',
      },
      textureOUT: { /* texture settings */ }
   },
    filters: {
        filter1Fragment: {
            active: true,
            type: 'fragment', // or 'compute' for compute shaders
            passes: [
                {
                    label: 'Filter 1 Pass 1',
                    active: true, // Individual pass can be enabled/disabled
                    inputTexture: ['texture'],
                     // Note you do want to create a texture called 'texture' 
                     // in your textures object. This is created by SequentialGPU 
                     // and is used by you to load the image texture into your filter 
                     // at a place of your choosing.
                    outputTexture: 'textureOUT',
                    shaderURL: 'path/to/shader.wgsl'
                }
            ],
            bufferAttachment: {
                groupIndex: 0,
                bindingIndex: 3, // Must be 3 =>
                bindings: {
                    uniformValue: {
                        type: 'uniform',
                        value: 255,
                        usage: 'read',
                    },
                    floatArray: {
                        type: 'float',
                        value: [0, 0, 0, 0],
                        usage: 'read',
                    }
                }
            }
        },
        filter2Compute: { // Example compute shader filter
            active: true,
            type: 'compute',
            passes: [
                {
                    label: 'Filter 2 Pass 1',
                    active: true,
                    inputTexture: ['textureOUT'],
                    shaderURL: 'path/to/compute.wgsl'
                }
            ],
            bufferAttachment: {
                groupIndex: 0,
                bindingIndex: 3, // Must be 3 =>
                bindings: {
                   floatArray: {
                       type: 'float',
                       value: new Array(256).fill(0),
                       usage: 'write',
                    }
                }
            }
        },
        filter3Fragment: { // Example fragment shader with 3 passes and drawing to the screen
            active: true,
            type: 'fragment',
            passes: [
                {
                    label: 'Filter 3 Pass 1',
                    active: true, // Individual pass can be enabled/disabled
                    inputTexture: ['textureIN'],
                    outputTexture: 'textureOUT',
                    shaderURL: 'path/to/shader.wgsl'
                },
                {
                    label: 'Filter 3 Pass 2',
                    inputTexture: ['textureOUT'],
                     // you may use the output texture from the previous pass 
                     // as the input texture for the next pass. SequentialGPU 
                     // will automaticly swap in a texture called 'textureTemp' 
                     // as a stand in so that 'textureOUT' be used as input and output.
                    outputTexture: 'textureOUT',
                    shaderURL: 'path/to/shader.wgsl'
                },
                {
                    label: 'Filter 3 Pass 3',
                    inputTexture: ['textureOUT'],
                    outputTexture: undefined,
                     // Setting the outputTexture to 'undefined' allows the 
                     // filters output to be drawn to the screen.
                     // Note that once this happens all preceding filters 
                     // will not be rendered.
                    shaderURL: 'path/to/shader.wgsl'
                }
            ],
            bufferAttachment: {
                groupIndex: 0,
                bindingIndex: 3, // Must be 3 =>
                bindings: {
                    uniformValue: {
                        type: 'uniform',
                        value: 255,
                        usage: 'read',
                    },
                    floatArray: {
                        type: 'float',
                        value: [0, 0, 0, 0],
                        usage: 'read',
                    }
                }
            }
        },
    }
};

// Initialize the app
const app = await SequentialGPU.createApp(settings).catch(error => {
   console.error("Error creating app:", error);
});
```
**Note**: The system automatically creates several required textures:
- `texture` - Main input texture for the initial image
- `textureMASS` - Multi-sample anti-aliasing texture 
- `textureTemp` - Temporary texture for intermediate processing

DO NOT specify these names in your settings object as they are managed internally.


### Key Methods

```js
// Load a specific image from the settings.images array
await app.loadImage(imageIndex);

// Resize canvas and recreate resources
await app.resize(width, height, resetSize);

// Update filter buffer values
// The app looks through all filters for bufferAttachment binding key that match.
// if you do not want all matching keys to be updated. 
// Please create a unique key for your bindings.
app.updateFilterBuffer('uniformValue', newValue);

// Update filter input texture
app.updateFilterInputTexture('filter1', passIndex, bindingIndex, 'newTextureKey', textureIndex);

// Update filters with new conditions
await app.updateFilters(filterUpdateConditions);

// Execute specific filter passes
// The app will render the filter pass and return a boolean value 
// indicating if the pass has an output texture or not.
// if true you have reached the screen rendering pass
// allowing you to break a custom loop
const isScreenRender = await app.renderFilterPasses(filter);

// Queue custom operations with priority control
// Operations are executed in order of priority then timestamp
// Operation: Function that returns a Promise
// Priority: String 'urgent', 'high', 'normal', 'low', 'background',
// Metadata: Object can be used to tag operations for easier management
await app.queueOperation(async () => {
    // Your custom GPU operation here
    return await someAsyncOperation();
}, 'high', { 
    type: 'custom', 
    operation: 'myOperation',
    description: 'Custom processing task'
});

// Wait for render completion
await app.waitForRenderComplete();

// Clean up resources
await app.dispose();
```


### Render Queue System

SequentialGPU includes a built-in render queue for managing GPU operations efficiently:

```js
// Queue operations with different priorities
await app.queueOperation(operation, priority, metadata);

// Get queue status and performance metrics
const status = app.getRenderQueueStatus();
const stats = app.getQueuePerformanceStats();

// Cancel operations by metadata
app.cancelRenderOperations('filterType');

// Clear the entire queue
app.clearRenderQueue();
```

**Priority Levels:**
- `'urgent'` - Highest priority, executed immediately
- `'high'` - High priority operations (default for render operations)
- `'normal'` - Standard priority (default)
- `'low'` - Lower priority operations
- `'background'` - Lowest priority, executed when queue is idle

**Metadata Object:**
The metadata parameter allows you to tag operations for easier management:
```js
{
    type: 'render',            // Operation category
    operation: 'filterUpdate', // Specific operation name
    filterType: 'blur',        // Custom properties for filtering
    urgent: true               // Custom flags
}
```


### Important Notes

1. Please note that the first filters input texture should be set to 'texture'. The app will automatically set the input image to this. You should not use 'texture' as an output texture.

2. `shaderURL` property in the `passes` object should be the path to the shader file. The shader file should contain the shader code in WGSL format.

3. `bufferAttachment` object should contain the buffer attachment settings for the filter. The `groupIndex` and `bindingIndex` properties should be set to the group and binding indices of the buffer attachment in the shader. NOTE `bindingIndex: 3` Is reserved for buffer attachment settings and is recomended for usage of all bufferAttachment however please remember to use uniqe names for all attachments. When updating a bufferAttachment SequentialGPU looks for all filters using the `key` of the bufferAttachment and updates the values for that filter.

4. `textures` object should contain the unique texture `key/name` followed by the texture parameters all of which are optional. 
   - `label` [optional] property used to label of the texture.
   - `format` [optional] default is the apps format defined in the setting object like this `rgba8unorm`. Otherwise, you can specify the format of the texture `rgba8unorm | rgba16float | rgba32float | r8unorm | r16float | r32float`.
   - `usage` [optional] property should be set to the usage of the texture. `GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST`
   - `sampleCount` [optional] property should be set to the sample count of the texture `1 or 4`.
   - `notes` [optional] property should be set to the notes of the texture.

5. For compute shaders:
   - Use `type: 'compute'` in the filter configuration
   - Buffer bindings can specify `usage: 'read'`, `'write'`, or `'readwrite'`

6. Binding restrictions:
   - Group 0, binding 0 is reserved for the sampler
   - Group 0, binding 1 is reserved for your first input textures
   - Group 0, binding 2 is reserved for your second input textures
   - Custom bindings should start at binding 3 or higher

7. By setting the `outputTexture` property to `undefined`, the app will render the that filters pass to the screen.


## API

### `WebGpuRenderer`

#### Constructor
- `SequentialGPU.createApp(settings)`
  - **settings**: Configuration object for WebGPU processing
  - **Returns**: Instance of [`WebGpuRenderer`](js/webGpuRenderer.js)

#### Methods
- `initialize()`: Set up WebGPU device and resources
- `loadImage(index)`: Load image from settings.images array  
- `resize(width, height, resetSize)`: Resize canvas and recreate resources
- `updateFilterBuffer(key, value)`: Update filter buffer values
- `updateFilterInputTexture(filterKey, passIndex, bindingIndex, textureKey, textureIndex)`: Update filter input texture
- `renderFilterPasses(filter)`: Execute all passes for a given filter
- `updateFilters()`: Update filter conditions and bindings
- `waitForRenderComplete()`: Wait for all GPU operations to complete

## Performance Features

SequentialGPU includes comprehensive performance optimizations and monitoring:

### Core Optimizations
- **Pipeline Caching** - Shaders and pipelines are cached using [`PipelineCacheManager`](js/pipelineCacheManager.js) for optimal performance
- **Object Pooling** - Texture and wrapper object pooling via [`SimpleTexturePool`](js/simpleTexturePool.js) and [`RenderQueue`](js/renderQueue.js)
- **Resource Tracking** - Automatic cleanup of GPU resources prevents memory leaks
- **Command Queue Management** - Efficient batching of GPU commands via [`CommandQueueManager`](js/commandQueueManager.js)
- **Fast Path Execution** - Optimized code paths for common operations
- **Memory Management** - Comprehensive texture memory tracking and cleanup

### Performance Monitoring
- **Built-in Benchmarking** - Run performance tests with `npm run performance`
- **Queue Performance Tracking** - Monitor operation throughput and timing
- **Memory Usage Analytics** - Track GPU memory allocation and pooling efficiency
- **Cache Performance Metrics** - Monitor pipeline and resource cache hit rates

### Performance Scripts
```bash
# Run comprehensive performance benchmarks
npm run performance

# Analyze bundle size and composition
npm run analyze

# Validate all builds and performance
npm run validate
```

The library achieves excellent performance with queue operations averaging <2ms and cache hit rates >99%.

## Development

### Building the Project
```bash
# Install dependencies
npm install

# Build all variants
npm run build:all

# Development build with watch mode
npm run dev

# Individual builds
npm run build:production  # Optimized for production
npm run build:debug       # Debug build with source maps  
npm run build:profile     # Profiling build for performance analysis
```

### Testing and Validation
```bash
# Run all validation tests
npm run test

# Performance benchmarking
npm run performance

# Bundle analysis
npm run analyze

# Validate production bundle
npm run test-production
```

### Project Structure
- [`src/`](src/) - All source code organized by functionality
  - [`src/core/`](src/core/) - Core rendering classes (WebGpuRenderer, GPUUtils)
  - [`src/queue/`](src/queue/) - Queue and command management
  - [`src/memory/`](src/memory/) - Memory and resource management (texture pooling, pipeline caching)
  - [`src/utils/`](src/utils/) - Utilities and helper classes
- [`public/`](public/) - Built bundles (production, debug, profile)
- [`scripts/`](scripts/) - Build tools and performance testing
- [`docs/`](docs/) - Documentation files
- [`rollup.config.js`](rollup.config.js) - Basic build configuration
- [`rollup.config.advanced.js`](rollup.config.advanced.js) - Advanced multi-target builds

## Contributing
This project is made available primarily as a resource for others to use and learn from. If you'd like to make modifications:

1. Fork/Clone the Repository: Create your own copy of the codebase to customize for your needs
2. Build Your Version: Make any modifications you need for your specific use case
3. Learn and Adapt: Feel free to use any parts of this code in your own projects according to the license

While I'm not actively reviewing pull requests at this time, I hope you find this library useful as a starting point for your own WebGPU image processing implementations.

## License
This project is licensed under the ISC License.
