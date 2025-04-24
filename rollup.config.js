import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
   input: './js/sequentialgpu.js',
   output: {
      file: 'public/bundle.js',
      format: 'es',
      name: 'SequentialGPU',
      sourcemap: true, // Enable source maps
   },
   plugins: [
      resolve(),
      commonjs(),
   ],
};
