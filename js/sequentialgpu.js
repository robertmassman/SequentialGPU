
import { WebGpuRenderer } from './webGpuRenderer.js';

export const SequentialGPU = {
   async createApp(settings) {
      const webGpuRenderer = new WebGpuRenderer({
         ...settings,
      });
      await webGpuRenderer.initialize();
      // Return the renderer instance so it can be used by the app
      return webGpuRenderer;
   }
};

export default SequentialGPU;