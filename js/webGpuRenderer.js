import PipelineManager from './pipelineManager.js';
import BufferManager from './bufferManager.js';
import TextureManager from './textureManager.js';
import BindingManager from './bindingManager.js';
import FilterManager from "./FilterManager.js";
import Histogram from "./histogram.js";
import CommandQueueManager from "./commandQueueManager.js";
import SettingsValidator from './settingsValidator.js';
import RecoveryManager from "./recoveryManager.js";
import DebugLogger from "./debugLogger.js";
import GPUUtils from './gpuUtils.js';

export class WebGpuRenderer {
   constructor(settings) {

      // ESSENTIAL SETTINGS BELOW
      this.imageIndex = settings.imageIndex;
      this.imageArray = settings.imageArray;

      this.presentationFormat = settings.presentationFormat || navigator.gpu.getPreferredCanvasFormat(); // Default format

      this.textures = { ...settings.textures };

      // Add default textures if not provided
      this._setupDefaultTextures();

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
      this.filterManager = null; // Will be initialized after device setup
      this.commandQueue = null; // Will be initialized after device setup
      this.videoProcessor = null; // Will be initialized after device setup


      this.canvas = document.createElement('canvas');
      this.canvas.width = 800;
      this.canvas.height = 800;
      this.canvas.id = 'webgpu-canvas';
      this.canvas.style.display = 'none';
      this.context = undefined;

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
      // DEBUG
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

      // Add disposal event listeners
      window.addEventListener('beforeunload', this._cleanup.bind(this));

   }

   /**
     * Setup default textures required for rendering pipeline
     * @private
     */
   _setupDefaultTextures() {
      // Setup primary texture for input image
      if (!this.textures.texture) {
         this.textures.texture = {
            copyImageTo: true,
            label: 'texture',
            notes: 'Primary texture for the input image/video frame. DO NOT WRITE OVER IT',
         };
      }

      // Setup multi-sample texture for anti-aliasing
      if (!this.textures.textureMASS) {
         this.textures.textureMASS = {
            label: 'textureMASS',
            notes: 'Texture used by colorAttachments in renderPass for Multi Sampling',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            sampleCount: 4,
         };
      }

      // Setup temporary texture for intermediate processing
      if (!this.textures.textureTemp) {
         this.textures.textureTemp = {
            label: 'textureTemp',
            notes: 'Temporary texture for output before copying back to the input texture',
         };
      }
   }

   /**
    * Clean up resources on page unload
    * @private
    */
   async _cleanup() {
      try {
         if (!this.isDisposed) {
            await this.dispose();
         }
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
         // Stop video processing
         if (this.videoProcessor) {
            this.videoProcessor.dispose();
            this.videoProcessor = null;
         }

         // Clear command queue
         if (this.commandQueue) {
            await this.commandQueue.flush();
            this.commandQueue.dispose();
         }

         // Wait for GPU operations
         await this.waitForGPU();

         // Clean up resources in order
         await this.cleanupResources('bindGroups');
         await this.cleanupResources('pipelines');
         await this.cleanupResources('textures');
         await this.cleanupResources('buffers');

         // Clean up texture manager
         if (this.textureManager) {
            await this.textureManager.destroyTextures();
         }

         // Clean up vertex buffers
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

         // Clean up pipeline manager
         if (this.pipelineManager) {
            this.pipelineManager.dispose();
         }

         // Clear all managers
         this.textureManager = null;
         this.bufferManager = null;
         this.pipelineManager = null;
         this.bindingManager = null;

         // Clean up RecoveryManager
         if (this.recoveryManager) {
            this.recoveryManager._clearProgressInterval();

            // Remove any UI elements
            if (this.recoveryManager.overlayElement) {
               this.recoveryManager.overlayElement.remove();
               this.recoveryManager.overlayElement = null;
            }

            if (this.recoveryManager.statusElement) {
               this.recoveryManager.statusElement.remove();
               this.recoveryManager.statusElement = null;
            }

            this.recoveryManager = null;
         }

         this.isDisposed = true;

         // Remove event listeners
         window.removeEventListener('beforeunload', this._cleanup.bind(this));

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

   // Reset the application state and resources
   async reset() {
      try {

         // Store current filter values before disposing resources
         const savedFilterValues = {};

         // Recursively extract all properties with 'value' in filters
         const extractValues = (obj, path = '') => {
            for (const key in obj) {
               if (obj[key] && typeof obj[key] === 'object') {
                  // If this property has a 'value' attribute, save it
                  if (obj[key].hasOwnProperty('value')) {
                     const fullPath = path ? `${path}.${key}` : key;
                     savedFilterValues[fullPath] = obj[key].value;
                  }

                  // Continue recursively exploring nested objects
                  if (!Array.isArray(obj[key])) {
                     extractValues(obj[key], path ? `${path}.${key}` : key);
                  }
               }
            }
         };

         // Extract values from all filters
         extractValues(this.filters);

         // Dispose of current resources
         await this.dispose();

         let response = await fetch(this.imageArray[this.imageIndex].filePath);
         let blob = await response.blob();
         let url = URL.createObjectURL(blob);

         await this.loadImageSource(url);
         await this.setupDevice();
         await this.createResources();

         // Restore saved filter values
         for (const key in savedFilterValues) {
            try {
               await this.updateFilterBuffer(key.split('.').pop(), savedFilterValues[key]);
            } catch (err) {
               console.warn(`Failed to restore filter value for ${key}:`, err);
            }
         }

         this.isDisposed = false;
      } catch (error) {
         console.error('Error resetting app:', error);
         throw error;
      }
   }

   /**
    * Load an image source (URL or Blob) into memory
    * @param {string|Blob} source - Image source URL or Blob
    * @returns {Promise<HTMLImageElement>} - Loaded image element
    */
   async loadImageSource(source) {
      try {
         // Create image and load it
         const img = new Image();

         return new Promise((resolve, reject) => {
            img.onload = () => {
               this.image = img;

               // Revoke object URL if needed
               if (typeof source !== 'string' || source.startsWith('blob:')) {
                  URL.revokeObjectURL(source);
               }

               resolve(img);
            };

            img.onerror = (error) => reject(error);
            img.src = source;
         });
      } catch (error) {
         console.error(`Failed to load image source`, error);
         throw error;
      }
   }


   // Resize with proper resource cleanup
   async resize(width, height, resetSize = false) {
      try {
         if (this.debug) {
            console.log('Resizing application from:', this.canvas.width, this.canvas.height, 'to:', width, height, resetSize);
         }

         // Wait for GPU to complete pending work
         await this.waitForGPU();

         // Check if video processor exists and if current file is video
         let isVideo = this.imageArray[this.imageIndex].type === 'Video';

         // Store video state if it's a video
         let videoState = null;
         if (isVideo && this.videoProcessor?.videoElement) {
            videoState = {
               currentTime: this.videoProcessor.videoElement.currentTime,
               paused: this.videoProcessor.videoElement.paused
            };
            // Pause video during resize to prevent frame changes
            this.videoProcessor.videoElement.pause();
         }

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
         } else {
            // If no pipeline manager exists, just create resources
            await this.createResources(isVideo);
         }

         // Restore video state if it was a video
         if (videoState && this.videoProcessor?.videoElement) {
            this.videoProcessor.videoElement.currentTime = videoState.currentTime;
            if (!videoState.paused) {
               await this.videoProcessor.videoElement.play();
            }
         }

         if (this.debug) {
            console.log('Resized canvas to:', this.canvas.width, this.canvas.height, resetSize);
         }

         return true;
      } catch (error) {
         console.error('Failed to resize application:', error);
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

      // Create tracked buffer with COPY_SRC usage
      this.positionBuffer = this.createTrackedBuffer({
         size: 24,
         usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      // Fullscreen triangle
      this.device.queue.writeBuffer(this.positionBuffer, 0, new Float32Array([
         -1, -1, // x, y,
         3, -1,  // x, y,
         -1, 3   // x, y,
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
      // Position and uvs for fullscreen triangle
      this.device.queue.writeBuffer(this.texCordBuffer, 0, new Float32Array([
         0, 1, // uvx, uvy
         2, 1, // uvx, uvy
         0, -1 // uvx, uvy
      ]));
   }

   async updateHistogram() {
      return Histogram.updateHistogram(this);
   }

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

         if (this.imageArray[this.imageIndex]) {
            let name = this.imageArray[this.imageIndex].name;
            this.adapter.label = name;
            this.device.label = name;
         }

         // Setup error handler
         this.device.addEventListener('uncapturederror', (event) => {
            console.error('WebGPU device error:', event.error);
            if (event.error.constructor.name === 'GPUDeviceLostInfo') {
               console.warn('Device explicitly reported as lost, initiating recovery');
               this.recoverRenderContext();
            }
         });

         this.textureManager = new TextureManager(this);
         this.bindingManager = new BindingManager(this);
         this.bufferManager = new BufferManager(this.device);
         this.pipelineManager = new PipelineManager(this);
         this.commandQueue = new CommandQueueManager(this.device);

      }
      catch (error) {
         console.error(`Failed to setup device: ${error}`);
      }
   }

   // Add this helper method to validate and fix filters after recovery
   validateAndFixFilters() {
      let needsRebuild = false;

      // Check all filters and passes for validity
      for (const [key, filter] of Object.entries(this.filters)) {
         if (!filter.passes || !Array.isArray(filter.passes)) {
            console.warn(`Filter ${key} has invalid passes array`);
            continue;
         }

         for (const pass of filter.passes) {
            // Skip inactive passes
            if (!pass.active) continue;

            // Check if pass needs its bind group recreated
            if (!pass.bindGroup || !pass.bindGroup[0] || !pass.pipeline) {
               needsRebuild = true;

               // If pipeline exists but bind group doesn't, try to rebuild just the bind group
               if (pass.pipeline && this.bindingManager) {
                  try {
                     // Create temporary bind group using pipeline layout
                     const tempBindGroup = this.device.createBindGroup({
                        layout: pass.pipeline.getBindGroupLayout(0),
                        entries: [
                           {
                              binding: 0,
                              /*resource: this.device.createSampler({
                                 magFilter: 'linear',
                                 minFilter: 'linear'
                              })*/
                              resource: GPUUtils.createStandardSampler(this.device)
                           },
                           // Add a basic texture binding - we'll get a more accurate one when filters run
                           {
                              binding: 1,
                              resource: this.textureManager.getTexture('texture').createView()
                           }
                        ]
                     });

                     // Set temporary bind group
                     pass.bindGroup = [tempBindGroup];
                  } catch (error) {
                     console.warn(`Could not create temporary bind group: ${error.message}`);
                  }
               }
            }
         }
      }

      return needsRebuild;
   }

   // Add this as a helper method to WebGpuRenderer
   async safeQueueFlush() {
      if (!this.commandQueue) {
         console.warn('Cannot flush: Command queue is null');
         return;
      }

      try {
         // Check if there are any pending commands
         if (this.commandQueue.pendingCommands &&
            this.commandQueue.pendingCommands.length > 0) {
            await this.commandQueue.flush();
            //console.log('Command queue flushed successfully');
         } else {
            //console.log('No pending commands to flush');
         }
      } catch (error) {
         console.error('Error flushing command queue:', error);
      }
   }

   /**
    * Creates a full-screen overlay to block UI interactions during recovery
    * @param {boolean} show - Whether to show or hide the overlay
    * @returns {HTMLElement} The blocking overlay element
    */
   createBlockingOverlay(show = true) {
      // Remove existing overlay if it exists
      let overlayEl = document.getElementById('recovery-overlay');
      if (overlayEl) {
         overlayEl.remove();
      }

      if (!show) return null;

      // Create new overlay
      overlayEl = document.createElement('div');
      overlayEl.id = 'recovery-overlay';

      // Style the overlay to cover the entire screen
      overlayEl.style.position = 'fixed';
      overlayEl.style.top = '0';
      overlayEl.style.left = '0';
      overlayEl.style.width = '100%';
      overlayEl.style.height = '100%';
      overlayEl.style.backgroundColor = 'rgba(240, 240, 240, 0.5)';
      overlayEl.style.backdropFilter = 'blur(3px)';
      overlayEl.style.zIndex = '9999'; // Below the status but above everything else
      //overlayEl.style.cursor = 'not-allowed';
      overlayEl.style.display = 'flex';
      overlayEl.style.justifyContent = 'center';
      overlayEl.style.alignItems = 'center';
      overlayEl.style.transition = 'opacity 0.3s ease';

      document.body.appendChild(overlayEl);
      return overlayEl;
   }

   async recoverRenderContext() {
      return this.recoveryManager.startRecovery();
   }

   /**
    * Create resources with proper tracking
    */
   async createResources(isVideo = false) {
      if (this.imageArray.length === 0) {
         return;
      }

      // Determine if source is video
      if (typeof isVideo !== 'boolean') {
         const type = this.imageArray[this.imageIndex]?.type;
         isVideo = type === 'Video';
      }

      // Get original dimensions
      let originalWidth = isVideo ?
         this.videoProcessor.videoElement.videoWidth : this.image.width;
      let originalHeight = isVideo ?
         this.videoProcessor.videoElement.videoHeight : this.image.height;

      // Calculate scaled dimensions
      let ratio = this.ratio || 1.0;

      let scaledWidth = Math.floor(originalWidth * ratio);
      let scaledHeight = Math.floor(originalHeight * ratio);

      // Set canvas dimensions to scaled size
      this.canvas.width = scaledWidth;
      this.canvas.height = scaledHeight;

      // Initialize WebGPU context
      this.context = this.canvas.getContext('webgpu', { alpha: true });

      if (!this.context) {
         throw new Error('Failed to get WebGPU context');
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
    * Initialize the program
    * @returns {Promise<{image: null}>}
    */
   async initialize() {
      try {

         // Validate settings before proceeding with initialization
         SettingsValidator.validateSettings(this);

         if (this.imageArray.length > 0 &&
            this.imageArray[this.imageIndex]) {
            let response = await fetch(this.imageArray[this.imageIndex].filePath);
            let blob = await response.blob();
            let url = URL.createObjectURL(blob);
            await this.loadImageSource(url);
         }

         // Setup WebGPU device
         await this.setupDevice();

         // Create initial resources
         if (this.image.width > 0) {
            await this.createResources();
         }

         // Initialize recovery manager
         this.recoveryManager = new RecoveryManager(this);

         // Initialize the filter processing manager
         this.filterManager = new FilterManager(this);

         // Create test button in debug mode
         if (this.debug) {
            this.recoveryManager.createTestButton();
         }

         this.debugLogger.log('App', 'Initialization complete');

         return true;

      }
      catch (error) {
         this.debugLogger.error('App', 'Initialization failed', error);
         throw error;
      }

   }

   /**
    * Creates or updates the recovery status element with proper styling
    * @param {string} message - Optional message to display
    * @param {string} status - Optional status (success, warning, error, recovery)
    * @param {Error|string} errorDetails - Optional error object or message for error
    * @returns {HTMLElement} The recovery status element
    */
   createRecoveryStatusElement(message = '', status = 'hidden', errorDetails = null) {
      // Remove existing element if it exists
      let statusEl = document.getElementById('recovery-status');
      if (statusEl) {
         statusEl.remove();
      }

      // Create new element
      statusEl = document.createElement('div');
      statusEl.id = 'recovery-status';

      // Base styling
      statusEl.style.position = 'fixed';
      statusEl.style.top = '50%';
      statusEl.style.left = '50%';
      statusEl.style.transform = 'translate(-50%, -50%)';
      statusEl.style.padding = '20px 30px';
      statusEl.style.borderRadius = '8px';
      statusEl.style.zIndex = '10000';
      statusEl.style.textAlign = 'center';
      statusEl.style.fontFamily = 'Arial, sans-serif';
      statusEl.style.fontSize = '24px';
      statusEl.style.transition = 'all 0.3s ease';
      statusEl.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.3)';
      statusEl.style.minWidth = '300px';

      // Status-specific styling
      if (status === 'error') {
         statusEl.style.backgroundColor = 'rgba(220, 53, 69, 0.9)';
         statusEl.style.color = '#fff';
         // Use provided message or generate default error message
         if (!message) {
            const errorMsg = errorDetails ?
               (errorDetails.message || errorDetails.toString() || 'Unknown error occurred') :
               'Unknown error occurred';

            message = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery Failed</h3>' +
               `<p>${errorMsg}</p>` +
               '<p style="margin-top: 10px;">Retrying in 5 seconds...</p>';
         }
      } else if (status === 'warning') {
         statusEl.style.backgroundColor = 'rgba(255, 193, 7, 0.9)';
         statusEl.style.color = '#212529';
         if (!message) {
            message = '<h3 style="margin: 0 0 10px 0;">WebGPU Warning</h3>' +
               '<p>Performance may be affected</p>';
         }
      } else if (status === 'success') {
         statusEl.style.backgroundColor = 'rgba(40, 167, 69, 0.9)';
         statusEl.style.color = '#fff';
         if (!message) {
            message = '<h3 style="margin: 0 0 10px 0;">Success</h3>' +
               '<p>Operation completed successfully</p>';
         }
      } else if (status === 'recovery') {
         statusEl.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
         statusEl.style.color = '#fff';
         if (!message) {
            message = '<h3 style="margin: 0 0 10px 0;">WebGPU Recovery</h3>' +
               '<p>Recovering from GPU context loss...</p>' +
               '<div style="width: 100%; height: 4px; margin-top: 15px; background: #333;">' +
               '<div id="recovery-progress" style="width: 0%; height: 100%; background: #0f6"></div></div>';
         }
      } else {
         // Hidden or default style
         statusEl.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
         statusEl.style.color = '#fff';
         statusEl.style.opacity = '0';
         statusEl.style.pointerEvents = 'none';
      }

      // Set content
      if (message) {
         statusEl.innerHTML = message;
      } else {
         statusEl.innerHTML = '<h3 style="margin: 0 0 10px 0;">WebGPU Status</h3>' +
            '<p>Ready</p>';
      }

      document.body.appendChild(statusEl);
      return statusEl;
   }




   async updateFilters(filterUpdateConditions = false) {
      if (!this.filterManager) {
         throw new Error('FilterManager not initialized');
      }
      return this.filterManager.updateFilters(filterUpdateConditions);
   }

   waitForRenderComplete() {
      if (!this.filterManager) {
         throw new Error('FilterManager not initialized');
      }
      return this.filterManager.waitForRenderComplete();
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

   updateFilterInputTexture(filterKey, passIndex, bindingIndex, textureKey, textureIndex) {
      try {
         if (!this.filterManager) {
            throw new Error('FilterManager not initialized');
         }
         if (!this.filters[filterKey]) {
            throw new Error(`Filter ${filterKey} not found, skipping update`);
         }
         return this.filterManager.updateFilterInputTexture(
            filterKey, passIndex, bindingIndex, textureKey, textureIndex
         );
      } catch (error) {
         console.warn(`Error updating texture for ${filterKey}:`, error.message);
         return false;
      }
   }

   stopRender() {
      if (this.filterManager) {
         this.filterManager.stopRender();
      }
   }

   // NEW CODE TO IMPROVE RENDERING
   // Expose prioritized rendering methods for external use
   async urgentRender(drawToCanvas, transformations, filterUpdateConditions) {
      return this.filterManager.urgentRender(drawToCanvas, transformations, filterUpdateConditions);
   }

   async backgroundUpdate(filterUpdateConditions) {
      return this.filterManager.backgroundUpdate(filterUpdateConditions);
   }

   async updateOutputCanvas(drawToCanvas, transformations, filterUpdateConditions, priority = 'high') {
      if (!this.filterManager) {
         throw new Error('FilterManager not initialized');
      }

      // Handle different priorities
      if (priority === 'background') {
         return this.filterManager.backgroundUpdate(filterUpdateConditions);
      }
      if (priority === 'urgent') {
         return this.filterManager.urgentRender(drawToCanvas, transformations, filterUpdateConditions);
      }

      // Default to normal update
      let testValue = await this.filterManager.updateOutputCanvas(drawToCanvas, transformations, filterUpdateConditions);
      return testValue;
   }

   // Expose queue management methods
   getRenderQueueStatus() {
      return this.filterManager.renderQueue.getStatus();
   }

   cancelRenderOperations(filterType) {
      return this.filterManager.renderQueue.cancelByMetadata('filterType', filterType);
   }

   // Add these methods if you want easier access to queue operations
   queueOperation(operation, priority = 'normal', metadata = {}) {
      return this.filterManager.renderQueue.queue(operation, priority, metadata);
   }

   clearRenderQueue() {
      return this.filterManager.renderQueue.clear();
   }

   getQueuePerformanceStats() {
      return this.filterManager.renderQueue.getPerformanceStats();
   }
}



export default WebGpuRenderer;