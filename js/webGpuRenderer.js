import PipelineManager from './pipelineManager.js';
import BufferManager from './bufferManager.js';
import TextureManager from './textureManager.js';
import VideoProcessor from './videoProcessor.js';
import BindingManager from './bindingManager.js';
import UpdateManager from "./updateManager.js";
import Histogram from "./histogram.js";
import CommandQueueManager from "./commandQueueManager.js";
import SettingsValidator from './settingsValidator.js';
import DebugLogger from "./debugLogger.js";

export class WebGpuRenderer {
   constructor(settings) {

      //// ESSENTIAL SETTINGS BELOW ////
      this.imageIndex = settings.imageIndex;
      this.imageArray = settings.imageArray;

      this.textures = settings.textures; // Store the textures parameter as a class property
      this.textures.texture = {
         copyImageTo: true,
         label: 'texture',
         notes: 'this is the texture that will be used to copy the image to. For the filters initial input. DO NOT WRITE OVER IT',
      };
      this.textures.textureMASS = {
         label: 'textureMASS',
         notes: 'This is the texture that will be used by the colorAttachments in the renderPass for Multi Sampling',
         usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
         sampleCount: 4,
      };
      this.textures.textureTemp = {
         label: 'textureTemp',
         notes: 'This is the texture that will be used to temporarily store the output of the filters. It will then be used for be copying back to the input texture',
      };

      this.filters = settings.filters;

      // Validate settings before proceeding
      try {
         SettingsValidator.validateSettings(settings);
      } catch (error) {
         console.error('Settings validation failed:', error.message);
         throw error;
      }
      this.textureManager = null; // Will be initialized after device setup
      this.bufferManager = null; // Will be initialized after device setup
      this.pipelineManager = null; // Will be initialized after device setup
      this.bindingManager = null; // Will be initialized after device setup
      this.commandQueue = null; // Will be initialized after device setup
      this.videoProcessor = null; // Will be initialized after device setup

      this.canvas = document.createElement('canvas');
      this.canvas.width = 800;
      this.canvas.height = 800;
      this.canvas.id = 'webgpu-canvas';
      this.canvas.style.display = 'none';
      this.context = undefined;

      this.updateManager = new UpdateManager(this);
      this.presentationFormat = settings.presentationFormat || navigator.gpu.getPreferredCanvasFormat(); // Default format

      this.ratio = 1.0;
      this.image = {
         width: 0,
         height: 0,
      };
      // Add resource tracking
      this.resources = {
         buffers: new Set(),
         textures: new Set(),
         bindGroups: new Set(),
         pipelines: new Set()
      };

      this.isDisposed = false; // Add disposal flag
      this.debug = settings.debug || false;

      // Add these to your main app initialization
      window.addEventListener('beforeunload', async (event) => {
         // Ensure cleanup happens before unload
         if (this) {
            await this.dispose();
         }
      });

      //// DEBUG ////
      // Only enable in development/debug mode
      this.debugLogger = new DebugLogger(settings.debug);
      // Example debug log
      if (settings.debug) {
         this.debugLogger.log('App', 'Initializing with settings:', settings);
      };
      // Modify the monitoring interval
      if (settings.debug) {
         this.monitoringInterval = setInterval(() => {
            this.debugLogger.log('Performance', 'Current Stats', {
               pipelineCache: this.pipelineManager?.getCacheStats(),
               commandQueue: this.commandQueue?.stats
            });
         }, 10000);
      };
      
   }

   async _cleanup() {
      try {
         // Prevent multiple cleanup attempts
         if (this.isDisposed) {
            return;
         }

         // Stop monitoring and intervals
         if (this.cacheMonitorInterval) {
            clearInterval(this.cacheMonitorInterval);
         }

         // Dispose of resources
         await this.dispose();

      } catch (error) {
         console.error('Error during cleanup:', error);
      }
   }

   /**
    * Dispose of all resources and cleanup
    */
   async dispose() {
      if (this.isDisposed) {
         return;
      }

      try {
         // Stop video processing first
         if (this.videoProcessor) {
            this.videoProcessor.dispose();
            this.videoProcessor = null;
         }

         // Stop render manager
         if (this.renderManager) {
            this.renderManager.cleanup();
            this.renderManager = null;
         }

         // Clear command queue
         if (this.commandQueue) {
            await this.commandQueue.flush();
            this.commandQueue.dispose();
         }

         // Wait for GPU operations
         await this.waitForGPU();

         // Clean up managers in order
         if (this.textureManager) {
            await this.textureManager.destroyTextures();
         }

         await this.cleanupResources('bindGroups');
         await this.cleanupResources('pipelines');
         await this.cleanupResources('textures');
         await this.cleanupResources('buffers');

         // Clean up buffers
         if (this.positionBuffer) {
            this.positionBuffer.destroy();
            this.positionBuffer = null;
         }

         if (this.texCordBuffer) {
            this.texCordBuffer.destroy();
            this.texCordBuffer = null;
         }

         // Clean up context and device
         if (this.context) {
            this.context.unconfigure();
         }

         if (this.device) {
            this.device.destroy();
         }

         if (this.pipelineManager) {
            this.pipelineManager.dispose();
         }

         // Clear all managers
         this.textureManager = null;
         this.bufferManager = null;
         this.pipelineManager = null;
         this.bindingManager = null;

         this.isDisposed = true;

         // Remove event listeners
         window.removeEventListener('beforeunload', this._cleanup.bind(this));
         document.removeEventListener('visibilitychange', this._cleanup.bind(this));

      } catch (error) {
         console.error('Error during cleanup:', error);
      }
   }

   trackResource(type, resource) {
      if (this.resources[type]) {
         this.resources[type].add(resource);
      }
   }

   createTrackedBuffer(descriptor) {
      const buffer = this.device.createBuffer(descriptor);
      this.trackResource('buffers', buffer);
      return buffer;
   }

   /**
    * Clean up specific resources
    * @param {string} type - Type of resources to clean up
    * @private
    */
   async cleanupResources(type) {
      if (this.resources[type]) {
         for (const resource of this.resources[type]) {
            try {
               if (resource && !resource.destroyed) {
                  if (typeof resource.destroy === 'function') {
                     resource.destroy();
                  }
               }
            } catch (error) {
               console.warn(`Error destroying ${type} resource:`, error);
            }
         }
         this.resources[type].clear();
      }
   }

   /**
    * Wait for the GPU to complete all pending operations
    * @private
    */
   async waitForGPU() {
      if (this.device) {
         try {
            await this.device.queue.onSubmittedWorkDone();
         } catch (error) {
            console.warn('Error waiting for GPU:', error);
         }
      }
   }

   /**
    * Reset the application state and resources
    */
   async reset() {
      try {
         // Dispose of current resources
         await this.dispose();

         // Reinitialize
         await this.setupDevice();
         await this.createResources();

         this.isDisposed = false;
      } catch (error) {
         console.error('Error resetting app:', error);
         throw error;
      }
   }

   async loadImageSource(blob) {
      try {
            let imageURL = blob;

            // Create image and load it
            const img = new Image();

            return new Promise((resolve, reject) => {
               img.onload = () => {
                  this.image = img;

                  // Only revoke the URL AFTER the image has loaded successfully
                  // And only if we created a new blob URL (not for string paths)
                  if (imageURL !== blob && (blob instanceof Blob ||
                     (typeof blob === 'object'))) {
                     URL.revokeObjectURL(imageURL);
                  }

                  resolve(img);
               };

               img.onerror = (error) => reject(error);
               img.src = imageURL;
            });
         } catch (error) {
            console.error(`Failed to load image URL ${blob}`, error);
            throw error;
         }
   }


   // Add this method to App class
   async initVideoProcessor() {
      if (!this.videoProcessor) {
         this.videoProcessor = new VideoProcessor(this);
      }
   }

   /**
    * Resize with proper resource cleanup
    */
   async resize(width, height, resetSize = false) {
      try {

            //console.log('Resizing application from:', this.canvas.width, this.canvas.height, 'to:', width, height, resetSize);

            // Wait for GPU to complete pending work
            await this.waitForGPU();

            // Check if video processor exists and if current file is video
            //let type = this.imageArray[this.imageIndex].type;
            let isVideo = this.imageArray[this.imageIndex].type === 'Video';

            // Get current dimensions based on source type
            const currentWidth = isVideo ? this.videoProcessor.videoElement.videoWidth : this.image.width;
            const currentHeight = isVideo ? this.videoProcessor.videoElement.videoHeight : this.image.height;

            // Calculate new ratio
            if (!resetSize) {
               this.ratio = 1.0;
            } else {
               let widthRatio = width / currentWidth;
               let heightRatio = height / currentHeight;
               this.ratio = Math.min(widthRatio, heightRatio);
            }

            // Store cache state before resizing
            if (this.pipelineManager) {
               const pipelineCacheState = this.pipelineManager.pipelineCacheManager.storeCacheState();

               // Release all active textures back to the pool
               const activeTextureKeys = Array.from(this.textureManager.activeTextures.keys());
               for (const key of activeTextureKeys) {
                  this.textureManager.releaseTexture(key);
               }

               // Recreate resources
               await this.createResources(isVideo);

               // Restore compatible cached items with new dimensions
               await this.pipelineManager.pipelineCacheManager.restoreCacheState(
                  pipelineCacheState,
                  {
                     width: this.canvas.width,
                     height: this.canvas.height
                  }
               );
            }
            else {
               // If no pipeline manager exists, just create resources
               await this.createResources(isVideo);
            }

            //console.log('Resized canvas to:', this.canvas.width, this.canvas.height, resetSize);

            return true;
         } catch (error) {
            console.error('Failed to resize application:', error);
            throw error;
         }
         
   }

   async clearBuffer(buffer) {
      // Create a temporary buffer to clear the buffer
      const tempBuffer = this.device.createBuffer({
         size: buffer.size,
         usage: GPUBufferUsage.COPY_SRC,
         mappedAtCreation: true
      });

      // Fill the temporary buffer with zeros
      new Uint8Array(tempBuffer.getMappedRange()).fill(0);
      tempBuffer.unmap();

      // Create a command encoder
      const commandEncoder = this.device.createCommandEncoder();

      // Copy the temporary buffer to the buffer to clear it
      commandEncoder.copyBufferToBuffer(tempBuffer, 0, buffer, 0, buffer.size);

      // Submit the commands
      const commandBuffer = commandEncoder.finish();
      this.device.queue.submit([commandBuffer]);
   }

   /**
    * Reads the histogram values from the GPU buffer.
    * @returns {Promise<number[]>} Array of histogram values
    * @throws {Error} If histogram buffer is not initialized
    */
   async readHistogramValues() {
      // Get histogram filter and validate

      const histogramFilter = this.filters.histogramCompute;
      if (!histogramFilter?.resources?.buffer) {
         throw new Error('Histogram buffer not initialized');
      }

      // Create buffer for reading data
      const readBackBuffer = this.device.createBuffer({
         size: 256 * Float32Array.BYTES_PER_ELEMENT, // 256 bins * 4 bytes per value
         usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
         label: 'Histogram ReadBack Buffer'
      });

      try {
         // Create and execute command encoder
         const commandEncoder = this.device.createCommandEncoder({
            label: 'Read Histogram Values'
         });

         const sourceBuffer = histogramFilter.resources.buffers?.histogram ||
            histogramFilter.resources.buffer;

         commandEncoder.copyBufferToBuffer(
            sourceBuffer,
            0,
            readBackBuffer,
            0,
            256 * Float32Array.BYTES_PER_ELEMENT
         );

         this.device.queue.submit([commandEncoder.finish()]);

         // Map and read the data
         await readBackBuffer.mapAsync(GPUMapMode.READ);
         const mappedRange = readBackBuffer.getMappedRange();
         const histogramData = new Uint32Array(mappedRange);

         // Copy the data to a regular array
         const histogram = Array.from(histogramData);

         // Cleanup
         readBackBuffer.unmap();

         // Clear the combinedBuffer after using it
         //await this.clearBuffer(sourceBuffer);

         return histogram;
      } finally {
         // Optional: destroy the readback buffer if it won't be reused
         readBackBuffer.destroy();
      }
   }

   /**
    * Reads and analyzes histogram data from the GPU
    * @returns {Promise<Object>} Histogram statistics
    */
   async readAndAnalyzeHistogram() {
      try {
         // Get histogram filter and validate
         const histogramFilter = this.filters.histogramCompute;
         if (!histogramFilter?.resources?.buffer) {
            throw new Error('Histogram buffer not initialized');
         }

         // Read raw histogram data
         const histogramData = await this.readHistogramValues();

         // Validate histogram data
         if (!histogramData || histogramData.length === 0) {
            console.warn('No histogram data received');
            return null;
         }

         // Calculate statistics
         const stats = Histogram.calculateStatistics(histogramData);

         // Add raw data to stats for debugging
         stats.rawHistogram = histogramData;

         // Log statistics
         if (this.debug) {
            console.log('Histogram Statistics:', {
               min: stats.min !== null ? stats.min / 255 : null,
               max: stats.max !== null ? stats.max / 255 : null,
               median: stats.median !== null ? stats.median / 255 : null,
               mean: stats.mean !== null ? stats.mean / 255 : null,
               total: stats.total
            });
         }

         return stats;
      } catch (error) {
         console.error('Error analyzing histogram:', error);
         throw error;
      }
   }

   /**
    * Create the position buffer and write the data to it
    * The coordinates in the position buffer represent
    * the positions of the vertices of a triangle in normalized device coordinates (NDC).
    * These coordinates are used to draw the triangle in the WebGPU rendering pipeline.
    * @returns {Promise<void>}
    */
   createPositionBuffer() {
      // Create the bindings for both position and texture coordinates
      this.bindingManager.createBindings(); // No resource needed yet

      // Create tracked buffer
      this.positionBuffer = this.createTrackedBuffer({
         size: 24,
         usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.positionBuffer, 0, new Float32Array([
         -1, -1,
         3, -1,
         -1, 3
      ]));
   }

   /**
    * Create the texCord buffer and write the data to it
    * the texCord buffer is used to draw the triangle and
    * represent the texture coordinates for the vertices of a triangle.
    * These coordinates are used to map the texture onto the triangle
    * in the WebGPU rendering pipeline.
    * @returns {Promise<void>}
    */
   createTexCordBuffer() {
      const key = Object.keys(this.textures)
         .find(key => this.textures[key].copyImageTo);
      const resource = key ? this.textureManager.getTexture(key).createView() : undefined;

      // Create tracked buffer
      this.texCordBuffer = this.createTrackedBuffer({
         size: 24,
         usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      this.device.queue.writeBuffer(this.texCordBuffer, 0, new Float32Array([
         0, 1,
         2, 1,
         0, -1
      ]));
   }

   /**
    * Update the filter buffer
    * @param {string} key - The property key to update.
    * @param {number, array} value - The value to update the filters buffer with.
    * @returns {Promise<void>}
    */
   async updateFilterBuffer(key, value) {

      /**
       * Recursively searches an object for a key and returns one or more arrays of keys that make up the object path.
       * @param {Object} obj - The object to search within.
       * @param {string} keyToFind - The key to search for.
       * @returns {Array} - An array of objects that contain the key.
       */
      function findObjectsWithKey(obj, keyToFind) {
         let result = [];

         /**
          * Recursively search the object for the key
          * @param {Object} obj - The object to search within.
          * @param {Array} path - The path to the object.
          */
         function search(obj, path) {

            // If the object is not null and is an object
            if (obj && typeof obj === 'object') {
               // Check if the object has the key we are searching for
               if (obj.hasOwnProperty(keyToFind)) {
                  // If the key is found add the path to the result array
                  result.push([...path, keyToFind]);
               }
               // Loop through the object keys
               for (const key in obj) {
                  // If the object at key is not null and is an object
                  if (obj[key] && typeof obj[key] === 'object') {
                     // Recursively search the object at key
                     search(obj[key], [...path, key]);
                  }
               }
            }
         }

         search(obj, []); // Start the search

         // after searching the entire object return the arrays of paths
         return result;
      }

      const pathArray = findObjectsWithKey(this.filters, key);

      for (const path of pathArray) {
         let filter;
         let bindings = this.filters;

         for (let i = 0; i < path.length - 1; i++) {
            bindings = bindings[path[i]];
            if (i === 0) filter = bindings;
         }

         const finalKey = path[path.length - 1];
         bindings[finalKey].value = value;

         // Validate the updated filter
         try {
            SettingsValidator.validateFilters({ [filter.label]: filter });
         } catch (error) {
            console.error('Filter validation failed after update:', error);
            throw error;
         }

         // Update the buffer using the BufferManager if resources exist
         if (filter.resources?.update) {
            filter.resources.update({
               [finalKey]: { value }
            });
         }
      }
   }

   /**
    * Update the resource texture in the bindGroupArray for a specific filter.
    * @param {string} filterKey - The key of the filter to update.
    * @param {number} passIndex - The pass index to update.
    * @param {number} bindingIndex - The binding index to update.
    * @param {string|array} textureKey - The texture key or array to update.
    * @param {number} textureIndex - The index of the texture to update.
    */
   updateFilterInputTexture(filterKey, passIndex, bindingIndex, textureKey, textureIndex) {
      this.bindingManager.updateFilterInputTexture(
         filterKey,
         passIndex,
         bindingIndex,
         textureKey,
         textureIndex,
         this.filters
      );
   }

   /**
    * Execute the filter for the given pass
    * @param {object} pass - The pass object to execute.
    * @param {string} type - The type of pass to execute.
    * @returns {Promise<boolean>}
    */
   async executeFilterPass(pass, type) {

      if (!pass.bindGroup) {
         console.error('Pass bindGroup is missing:', pass.label);
         return false;
      }

      if (!pass.bindGroup[0]) {
         console.error('Pass bindGroup[0] is missing:', pass.label);
         return false;
      }

      const bindGroupArray = this.bindingManager.getBindGroupArray();
      if (!bindGroupArray[0]) {
         console.error('BindGroupArray[0] is missing');
         return false;
      }
      /////////
      if (this.debug) {
         this.debugLogger.log('FilterExecution', `Executing ${type} pass:`, {
            label: pass.label,
            inputTextures: pass.inputTexture,
            outputTexture: pass.outputTexture
         });
      }

      // Debug texture state before execution
      if (pass.label.includes('debug')) {  // Add debug flag to passes you want to track
         console.log(`Executing ${pass.label}`);
         console.log('Input textures:', pass.inputTexture);
         console.log('Output texture:', pass.outputTexture);
         this.textureManager.debugTextures();
      }

      // You would access it through the binding manager
      //const bindGroupArray = this.bindingManager.getBindGroupArray();

      if (!pass.bindGroup || !bindGroupArray[0]) {
         console.error('No bind group available for pass:', pass.label);
         return false;
      }

      const { outputTexture, pipeline } = pass;
      const commandEncoder = this.device.createCommandEncoder({
         label: `Encoder for ${pass.label}`
      });

      if (type === 'compute') {
         // Get histogram filter and validate
         const histogramFilter = this.filters.histogramCompute;
         if (!histogramFilter?.resources?.buffer) {
            throw new Error('Histogram buffer not initialized');
         }
         const sourceBuffer = histogramFilter.resources.buffers?.histogram ||
            histogramFilter.resources.buffer;
         // Clear the combinedBuffer before rewriting to is using it
         await this.clearBuffer(sourceBuffer);

         this.commandQueue.addComputePass({
            label: `Compute pass for ${pass.label}`,
            descriptor: {
               label: `Compute pass for ${pass.label}`
            },
            commands: (computePass) => {
               computePass.setPipeline(pipeline);
               computePass.setBindGroup(0, pass.bindGroup[0]);

               const workgroupSizeX = 16;
               const workgroupSizeY = 16;
               const dispatchX = Math.ceil(this.canvas.width / workgroupSizeX);
               const dispatchY = Math.ceil(this.canvas.height / workgroupSizeY);

               computePass.dispatchWorkgroups(dispatchX, dispatchY);
            }
         });
      }
      else {
         // If we're writing to the same texture we're reading from, use a temporary texture
         const shouldUseTemp = pass.inputTexture.includes(outputTexture);
         const finalOutputTexture = shouldUseTemp ? 'textureTemp' : outputTexture;

         // Debug texture selection
         if (pass.label.includes('debug')) {
            console.log('Should use temp:', shouldUseTemp);
            console.log('Final output texture:', finalOutputTexture);
         }

         this.commandQueue.addRenderPass({
            label: `Render pass for ${pass.label}`,
            descriptor: {
               colorAttachments: [{
                  view: this.textureManager.getTexture('textureMASS').createView(),
                  resolveTarget: finalOutputTexture ?
                     this.textureManager.getTexture(finalOutputTexture).createView() :
                     this.context.getCurrentTexture().createView(),
                  loadOp: 'clear',
                  storeOp: 'store',
                  clearValue: [0, 0, 0, 0]
               }]
            },
            commands: (renderPass) => {
               renderPass.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
               renderPass.setPipeline(pipeline);
               renderPass.setBindGroup(0, pass.bindGroup[0]);
               renderPass.setVertexBuffer(0, this.positionBuffer);
               renderPass.setVertexBuffer(1, this.texCordBuffer);
               renderPass.draw(3);
            }
         });

         // If we used a temporary texture, copy it to the final destination
         if (shouldUseTemp && outputTexture) {
            this.commandQueue.addTextureCopy({
               label: `Copy temp to ${outputTexture}`,
               source: { texture: this.textureManager.getTexture('textureTemp') },
               destination: { texture: this.textureManager.getTexture(outputTexture) },
               copySize: {
                  width: this.canvas.width,
                  height: this.canvas.height,
                  depthOrArrayLayers: 1
               }
            });
         }

         // Flush commands if this is the final pass
         if (outputTexture === undefined) {
            await this.commandQueue.flush();
            return true;
         }

         return false;
      }
   }

   async renderFilterPasses(filter) {
      let breakLoop = false;
      // loop through the passes
      for (const pass of filter.passes) {
         if (pass.active) {
            breakLoop = await this.executeFilterPass(pass, filter.type);
         }
         if (breakLoop) {
            break;
         }
      }
      return breakLoop;
   }

   /**
    * Set up the device, context, and canvas
    * @returns {Promise<void>}
    */
   async setupDevice() {
      try {

         // Request adapter with more robust features
         this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance',
            forceFallbackAdapter: false
         });

         if (!this.adapter) {
            throw new Error('No WebGPU adapter found');
         }

         // Request device with options that might help persistence
         this.device = await this.adapter.requestDevice({
            requiredFeatures: [
               // Any features your app needs
            ],
            requiredLimits: {
               // Any specific limits your app needs
            }
         });

         // Set up uncaptured error handler for early detection of context issues
         this.device.addEventListener('uncapturederror', (event) => {
            console.error('WebGPU device error:', event.error);

            // If this is a device lost error, trigger recovery
            if (event.error.constructor.name === 'GPUDeviceLostInfo') {
               console.warn('Device explicitly reported as lost, initiating recovery');
               this.recoverRenderContext();
            }
         });

         if (this.imageArray[this.imageIndex]) {
            let name = this.imageArray[this.imageIndex].name;
            this.adapter.label = name;
            this.device.label = name;
         }

         this.textureManager = new TextureManager(this);

         this.bindingManager = new BindingManager(this);

        

      }
      catch (error) {
         console.error(`Failed to setup device: ${error}`);
      }
   }

   /**
    * Create resources with proper tracking
    */
   async createResources(isVideo = false) {
      if (this.imageArray.length === 0) {
         return;
      }

      let type = this.imageArray[this.imageIndex].type;
      isVideo = type === 'Video';

      // Get original dimensions
      let originalWidth = isVideo ? this.videoProcessor.videoElement.videoWidth : this.image.width;
      let originalHeight = isVideo ? this.videoProcessor.videoElement.videoHeight : this.image.height;

      // Calculate scaled dimensions
      let ratio = this.ratio || 1.0;
      //let ratio = 0.416;
      let scaledWidth = Math.floor(originalWidth * ratio);
      let scaledHeight = Math.floor(originalHeight * ratio);

      // Set canvas dimensions to scaled size
      this.canvas.width = scaledWidth;
      this.canvas.height = scaledHeight;

      try {
         this.context = this.canvas.getContext('webgpu', { alpha: true });
      } catch (error) {
         console.error('Error initializing WebGPU context:', error);
         throw error;
      }

      if (!this.device) {
         await this.setupDevice();
      }

      try {
         // Configure context with scaled dimensions
         this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
            size: {
               width: scaledWidth,
               height: scaledHeight
            },
         });

         // Create textures with scaled dimensions
         await this.textureManager.createTextures({
            textures: this.textures,
            canvas: {
               width: scaledWidth,
               height: scaledHeight
            }
         });

         // Create a temporary canvas for scaling
         const tempCanvas = document.createElement('canvas');
         tempCanvas.width = scaledWidth;
         tempCanvas.height = scaledHeight;
         const tempCtx = tempCanvas.getContext('2d');
         tempCtx.imageSmoothingQuality = 'high';

         //console.log('this image:', this.image);

         // Copy and scale initial frame/image
         if (isVideo) {
            // Draw the video frame onto the temporary canvas with scaling
            tempCtx.drawImage(
               this.videoProcessor.videoElement,
               0, 0,
               originalWidth, originalHeight,  // Source dimensions
               0, 0,
               scaledWidth, scaledHeight      // Destination dimensions
            );

            // Copy the scaled frame to the texture
            await this.textureManager.copyImageToTexture(
               tempCanvas,
               'texture',
               {
                  width: scaledWidth,
                  height: scaledHeight
               }
            );
         } else {
            // Handle still images
            await this.textureManager.copyImageToTexture(
               this.image,
               'texture',
               {
                  width: scaledWidth,
                  height: scaledHeight
               }
            );
         }

         // Create buffers and initialize managers
         await this.createPositionBuffer();
         await this.createTexCordBuffer();

         if (!this.bufferManager) {
            this.bufferManager = new BufferManager(this.device);
         }
         if (!this.pipelineManager) {
            this.pipelineManager = new PipelineManager(this);
         }
         if (!this.commandQueue) {
            this.commandQueue = new CommandQueueManager(this.device);
         }

         // Create pipelines for all filters
         for (const [, filter] of Object.entries(this.filters)) {
            filter.resources = await this.pipelineManager.createFilterPipeline(filter);
         }

         if (this.debug) {
            const cacheStats = this.pipelineManager.pipelineCacheManager.getCachePerformance();
            console.log('Pipeline Cache Performance:', cacheStats);
         }

      } catch (error) {
         console.error('Error creating resources:', error);
         throw error;
      }
   }

   /**
 * Reports a shader compilation error to the user
 * @param {Object} errorDetails - The error details object
 */
   reportShaderError(errorDetails) {
      if (!this.debug) return;

      const { label, summary, details, errorCount } = errorDetails;

      // Log to console
      console.error(`Shader Compilation Error (${label})`, {
         summary,
         details,
         errorCount
      });

      // Create or update error overlay for immediate user feedback
      let errorOverlay = document.getElementById('sequentialgpu-error-overlay');
      if (!errorOverlay) {
         errorOverlay = document.createElement('div');
         errorOverlay.id = 'sequentialgpu-error-overlay';
         errorOverlay.style.cssText = `
           position: fixed;
           bottom: 0;
           left: 0;
           right: 0;
           background: rgba(200, 0, 0, 0.85);
           color: white;
           padding: 10px;
           font-family: monospace;
           max-height: 30vh;
           overflow: auto;
           z-index: 10000;
           white-space: pre-wrap;
           border-top: 2px solid #ff0000;
       `;
         document.body.appendChild(errorOverlay);
      }

      // Update content
      errorOverlay.innerHTML = `
       <h3>Shader Error: ${label}</h3>
       <div>${details.map(d => `<div>${d}</div>`).join('')}</div>
       <button style="margin-top: 10px; padding: 5px 10px; background: #333; border: none; color: white; cursor: pointer;">
           Dismiss
       </button>
   `;

      // Add dismiss button handler
      errorOverlay.querySelector('button').onclick = () => {
         errorOverlay.style.display = 'none';
      };

      // Auto-hide after 15 seconds
      setTimeout(() => {
         if (errorOverlay) errorOverlay.style.display = 'none';
      }, 15000);
   }

   /**
    * Initialize the program
    * @returns {Promise<{image: null}>}
    */
   async initialize() {
      try {

         // Validate settings before proceeding with initialization
         SettingsValidator.validateSettings(this);

         try {
            if (this.imageArray.length > 0) {
               //this.imageIndex = 1;
               if (this.imageArray[this.imageIndex]) {

                  let response = await fetch(this.imageArray[this.imageIndex].filePath);
                  let blob = await response.blob();
                  let url = URL.createObjectURL(blob);

                  await this.loadImageSource(url);
                  await this.setupDevice();
                  await this.createResources();
               }
            }
            else {
               await this.setupDevice();
            }
         }
         catch (error) {
            console.error('Error initializing App:', error);
         }

      }
      catch (error) {
         console.error(`Group Binding: ${error}.`, error);
      }

   }

}

export default WebGpuRenderer;