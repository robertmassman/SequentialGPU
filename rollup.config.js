import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
   input: './src/index.js',
   output: {
      file: 'public/bundle.js',
      format: 'es',
      name: 'SequentialGPU',
      sourcemap: true, // Enable source maps
      inlineDynamicImports: true // Add this to handle multiple chunks
   },
   plugins: [
      resolve(),
      commonjs(),
   ],
};
