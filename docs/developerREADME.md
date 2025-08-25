# SequentialGPU - Developer Documentation

## Architecture Overview

```
SequentialGPU
├── App (Main controller)
├── TextureManager (Texture resource management)
├── FilterManager (Filter configuration and execution)
├── ShaderManager (Shader compilation and pipeline creation)
├── CommandQueueManager (WebGPU command batching and submission)
└── Utilities (Helper functions)
```
## Core Components

### App
Central controller class that exposes the public API and orchestrates other components:
- Initializes WebGPU resources
- Coordinates filter execution sequence
- Manages canvas presentation
- Handles user-facing operations

### TextureManager
Responsible for creating and managing WebGPU texture resources:
- Creates system textures (`texture`, `textureMASS`, `textureTemp`)
- Creates user-defined textures based on settings
- Handles texture resize operations
- Manages texture views and sampling states

### FilterManager
Processes filter configurations and manages execution flow:
- Validates filter definitions
- Sets up binding groups for shaders
- Manages filter state (active/inactive)
- Handles pass sequencing logic

### ShaderManager
Loads, compiles, and caches shader code:
- Fetches shader code from URLs
- Creates render and compute pipelines
- Manages shader module lifecycle
- Validates shader compatibility

### CommandQueueManager
Optimizes WebGPU command encoding and submission:
- Batches related operations for better performance
- Handles command encoder lifecycle
- Provides abstract methods for common operations:
    - `addCommand(commandFn)`
    - `addRenderPass(descriptor, renderFunction)`
    - `addComputePass(descriptor, computeFunction)`
    - `addTextureCopy(source, destination, copySize)`
    - `addBufferCopy(source, destination, size)`
    - `flush()`

## WebGPU Resource Management

### Buffer Management
- Storage and uniform buffers are created for each filter's `bufferAttachment`
- Buffers are sized appropriately based on data type and length
- Usage flags are set based on read/write requirements

### Binding Groups
- Group 0, binding 0: Sampler (fixed)
- Group 0, binding 1: Primary input texture (fixed)
- Group 0, binding 2: Secondary input texture (fixed)
- Group 0, binding 3+: Custom bindings (user-defined)

### Texture Workflow
1. System creates default textures at initialization
2. User-defined textures are created based on settings
3. Texture swap mechanism handles intermediate pass results
4. Final output is presented to the canvas or written to output texture

## Rendering Pipeline

### Fragment Shader Pipeline
1. Set up render pass with color attachments
2. Configure viewport and scissor rect
3. Set pipeline and bind groups
4. Draw quad (2 triangles)
5. End pass and submit commands

### Compute Shader Pipeline
1. Set up compute pass
2. Set pipeline and bind groups
3. Dispatch workgroups based on texture dimensions
4. End pass and submit commands

## Implementation Details

### CommandQueueManager Batching
- Commands are collected until batch size threshold is reached
- Each batch is encoded and submitted as a group
- Automatic flushing occurs when necessary
- Manual flushing can be triggered for synchronization points

### Texture Swapping
The system handles input/output conflicts by:
1. Detecting when a texture is used as both input and output
2. Automatically using `textureTemp` as an intermediate buffer
3. Copying results back to the intended output texture

### Buffer Updates
When `updateFilterBuffer` is called:
1. All filters are searched for matching binding key
2. Matching buffers are updated with new data
3. Type conversion is performed if necessary

## Performance Considerations
- Minimize texture copies between passes
- Batch related operations via CommandQueueManager
- Prefer compute shaders for non-visual operations
- Reuse textures and buffers where possible
- Avoid GPU synchronization points

## Code Structure

### Key Files
- `app.js` - Main application controller
- `textureManager.js` - Texture creation and management
- `filterManager.js` - Filter processing and execution
- `shaderManager.js` - Shader loading and pipeline creation
- `commandQueueManager.js` - Command batching and submission
- `utils.js` - Helper functions and utilities

## Extending the Library

### Adding New Filter Types
1. Define filter configuration schema
2. Create appropriate shader bindings
3. Implement execution logic in FilterManager
4. Add validation rules

### Supporting New Buffer Types
1. Add type definition to buffer creation logic
2. Implement appropriate data conversion
3. Update binding logic

## Debugging and Testing

### Useful Debug Patterns
- Add label properties to all GPU resources
- Use the browser's WebGPU error capture
- Implement validation layers during development
- Create visual debug outputs for intermediate textures

### Common Issues
- Binding mismatch between shader and JavaScript
- Texture format compatibility issues
- Command submission ordering problems
- Resource lifetime management