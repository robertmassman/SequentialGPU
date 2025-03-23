
import { App } from './app.js';

export const SequentialGPU = {
   async createApp(settings) {
      const app = new App(settings);
      await app.initialize();
      return app;
   }
};

export default SequentialGPU;