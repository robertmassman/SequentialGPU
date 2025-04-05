
import { WebGpuRenderer } from './webGpuRenderer.js';

export const SequentialGPU = {
   async createApp(settings) {
      const webGpuRenderer = new WebGpuRenderer({
         ...settings,
      });
      await webGpuRenderer.initialize();

      return webGpuRenderer;
   }
};

export default SequentialGPU;