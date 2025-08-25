# WebGPU Application Documentation

## Overview
This application provides a WebGPU-based image processing system that supports both render and compute shader operations. The system is designed with a modular architecture where different managers handle specific aspects of the WebGPU pipeline, enabling sequential filter processing with multi-pass support.

## Core Classes

### App Class
The main application class that orchestrates all WebGPU operations.

#### Key Properties
```typescript
class App {
    settings: Settings;                 // Application settings and configuration
    device: GPUDevice;                 // WebGPU device
    canvas: HTMLCanvasElement;         // Hidden WebGPU canvas
    context: GPUCanvasContext;         // WebGPU context
    ratio: number;                     // Image scaling ratio
    image: HTMLImageElement;           // Current image element
    presentationFormat: GPUTextureFormat; // Texture format
    textureManager: TextureManager;    // Texture management
    bufferManager: BufferManager;      // Buffer management
    pipelineManager: PipelineManager;  // Pipeline management
    bindingManager: BindingManager;    // Binding management
}
```

#### Key Methods
- `initialize()`: Sets up the WebGPU environment and validates settings
- `loadImage(index: number)`: Loads an image from the settings.images array
- `resize(width: number, height: number, resetSize: boolean)`: Handles canvas and texture resizing
- `readHistogramValues()`: Reads data from histogram compute shader
- `updateFilterBuffer(key: string, value: number|array)`: Updates filter parameters
- `updateFilterInputTexture(filterKey: string, passIndex: number, bindingIndex: number, textureKey: string|string[], textureIndex: number)`: Updates texture bindings
- `executeFilterPass(pass: FilterPass, type: string)`: Executes a single filter pass
- `renderFilterPasses(filter: Filter)`: Executes all passes for a filter

### Settings Interface
```typescript
interface Settings {
    images: string[];                  // Array of image paths
    presentationFormat: string;        // GPU texture format
    textures: {                        // Texture definitions
        texture: {                     // Required initial texture
            copyImageTo: true,
            label: string,
            notes: string
        },
        textureMASS: {                // Required for multi-sampling
            label: string,
            notes: string,
            usage: GPUTextureUsageFlags,
            sampleCount: number
        },
        textureTemp: {                // Required for temporary storage
            label: string,
            notes: string
        },
        [key: string]: TextureSettings // Additional custom textures
    };
    filters: {                        // Filter definitions
        [key: string]: FilterSettings;
    };
}

interface FilterSettings {
    active: boolean;                  // Filter enabled state
    type: 'render' | 'compute';       // Shader type
    passes: FilterPass[];             // Processing passes
    bufferAttachment: {
        groupIndex: number;           // Bind group index
        bindingIndex: number;         // Must be > 1 for group 0
        bindings: {                   // Buffer bindings
            [key: string]: {
                type?: 'uniform' | 'float';
                value?: number | number[];
                usage?: 'read' | 'write' | 'readwrite';
                size?: number;        // Required for compute shaders
            }
        }
    }
}

interface FilterPass {
    active: boolean;                  // Pass enabled state
    inputTexture: string[];           // Input texture array
    outputTexture?: string;           // Optional output texture
    shaderURL: string;               // WGSL shader URL
    label?: string;                   // Pass identifier
}
```

## Manager Classes

### TextureManager
Manages WebGPU texture resources.

#### Key Methods
- `createTextures(settings: TextureSettings)`: Creates all required textures
- `copyImageToTexture(image: HTMLImageElement, textureKey: string, dimensions: Dimensions)`: Copies image to GPU texture
- `copyTextureToTexture(commandEncoder: GPUCommandEncoder, source: string, destination: string, dimensions: Dimensions)`: Copies between textures
- `destroyTextures()`: Cleans up all textures
- `getTexture(key: string)`: Retrieves a texture by key

### BufferManager
Handles GPU buffer creation and management with support for both uniform and storage buffers.

#### Key Methods
- `createFilterBuffers(filter: FilterSettings)`: Creates buffers for a filter
- `createComputeBuffer(filter: FilterSettings, binding: BindingConfig)`: Creates compute shader buffers
- `updateBufferData(buffer: GPUBuffer, newBindings: object, originalBindings: object)`: Updates buffer contents
- `calculateBufferSize(binding: BindingConfig)`: Determines buffer size with proper alignment

### PipelineManager
Manages render and compute pipelines, including shader compilation and pipeline setup.

#### Key Methods
- `createFilterPipeline(filter: FilterSettings)`: Creates complete pipeline for a filter
- `loadShader(url: string)`: Loads and caches WGSL shader code
- `createBindGroupLayout(filter: FilterSettings, pass: FilterPass)`: Creates bind group layouts
- `createBindGroup(layout: GPUBindGroupLayout, filter: FilterSettings, pass: FilterPass, bufferResource: any)`: Creates bind groups

### BindingManager
Handles resource bindings and updates.

#### Key Methods
- `createPositionBufferBindings()`: Sets up vertex position bindings
- `createTexCoordBindings(resource: GPUTextureView)`: Sets up texture coordinate bindings
- `updateFilterInputTexture(filterKey: string, passIndex: number, bindingIndex: number, textureKey: string|string[], textureIndex: number)`: Updates texture bindings
- `updateTextureBindings(filter: FilterSettings, pass: FilterPass, layout: object, groupIndex: number, bindingIndex: number)`: Handles texture binding updates

## WebGPU Features

1. **Multi-Sample Anti-Aliasing (MSAA)**
   - 4x multi-sampling for render passes
   - Implemented through textureMASS texture

2. **Compute Shader Support**
   - Histogram computation
   - Buffer read/write operations
   - Workgroup-based execution

3. **Advanced Buffer Management**
   - Uniform buffers for render passes
   - Storage buffers for compute shaders
   - Automatic padding and alignment
   - Dynamic buffer updates

4. **Texture Management**
   - Multiple texture support
   - Automatic texture creation and cleanup
   - Texture copying and manipulation
   - Support for various formats and usage flags

## Best Practices

1. **Resource Management**
   - Always destroy textures before resize operations
   - Use temporary textures for intermediate results
   - Handle device loss scenarios
   - Implement proper error handling

2. **Buffer Usage**
   - Start buffer bindings after index 1 in group 0
   - Use proper buffer types for compute vs. render
   - Maintain proper alignment for uniform data
   - Handle buffer size calculations carefully

3. **Pipeline Setup**
   - Cache shader modules
   - Use appropriate bind group layouts
   - Handle pipeline creation errors
   - Validate filter configurations

4. **Performance Considerations**
   - Reuse command encoders when possible
   - Batch render operations
   - Use compute shaders for parallel processing
   - Implement proper resource cleanup

## Error Handling
The application implements comprehensive error checking through the SettingsValidator class:
- Validates presentation format
- Ensures required textures exist
- Validates filter configurations
- Checks buffer attachments
- Validates binding configurations

## Usage Examples

### Basic Filter Configuration
```javascript
const settings = {
    images: ['image1.jpg', 'image2.jpg'],
    presentationFormat: 'rgba8unorm',
    textures: {
        texture: {
            copyImageTo: true,
            label: 'texture',
            notes: 'Initial input texture'
        },
        textureMASS: {
            label: 'textureMASS',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            sampleCount: 4
        },
        textureTemp: {
            label: 'textureTemp'
        }
    },
    filters: {
        myFilter: {
            active: true,
            type: 'render',
            passes: [{
                active: true,
                inputTexture: ['texture'],
                outputTexture: 'textureTemp',
                shaderURL: 'shaders/myShader.wgsl'
            }],
            bufferAttachment: {
                groupIndex: 0,
                bindingIndex: 3,
                bindings: {
                    parameter: {
                        type: 'uniform',
                        value: 1.0
                    }
                }
            }
        }
    }
};
```

### Application Usage
```javascript
// Create and initialize the app
const app = new App(settings);
await app.initialize();

// or using the SequentialGPU factory method
const app = await SequentialGPU.createApp(settings).catch(error => {
   console.error("Error creating app:", error);
});

// Load a specific image
await app.loadImage(1);

// Update a filter parameter
await app.updateFilterBuffer('parameter', 2.0);

// Execute a filter
await app.renderFilterPasses(settings.filters.myFilter);

// Clean up when done
await app.textureManager.destroyTextures();
```
