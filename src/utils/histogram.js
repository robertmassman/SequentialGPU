class Histogram {
    static calculateStatistics(histogram) {
        if (!histogram || histogram.length === 0) {
            return { median: null, min: null, max: null, mean: null, total: 0 };
        }

        const total = histogram.reduce((sum, freq) => sum + freq, 0);
        if (total === 0) {
            return { median: null, min: null, max: null, mean: null, total: 0 };
        }

        let min = null;
        let max = null;
        let sum = 0;
        let medianValue = null;
        const half = total / 2;
        let cumulativeFrequency = 0;

        // First pass: find min, max, and calculate sum for mean
        for (let i = 0; i < histogram.length; i++) {
            if (histogram[i] > 0) {
                if (min === null) min = i;
                max = i;
                sum += i * histogram[i];
            }
        }

        // Second pass: find median
        for (let i = 0; i < histogram.length; i++) {
            cumulativeFrequency += histogram[i];
            if (cumulativeFrequency >= half && medianValue === null) {
                // Interpolate for more accurate median
                const prevCumulative = cumulativeFrequency - histogram[i];
                const fraction = (half - prevCumulative) / histogram[i];
                medianValue = i + fraction;
            }
        }

        return {
            median: medianValue,
            min,
            max,
            mean: sum / total,
            total,
            normalizedHistogram: histogram.map(value => value / total)
        };
    }

    /**
     * Updates histogram data and triggers callback if present
     * @param {WebGpuRenderer} renderer - The WebGPU renderer instance
     * @returns {Promise<Object|null>} Histogram statistics
     */
    static async updateHistogram(renderer) {
        try {
            const stats = await this.readAndAnalyzeHistogram(renderer);
            if (stats && renderer.onHistogramUpdate) {
                renderer.onHistogramUpdate(stats);
            }
            return stats;
        } catch (error) {
            console.error('Error updating histogram:', error);
            return null;
        }
    }

    /**
     * Reads the histogram values from the GPU buffer
     * @param {WebGpuRenderer} renderer - The WebGPU renderer instance
     * @returns {Promise<number[]>} Array of histogram values
     */
    static async readHistogramValues(renderer) {
        // Get histogram filter and validate
        const histogramFilter = renderer.filters.histogramCompute;

        if (!histogramFilter?.resources?.buffer) {
            console.warn('Histogram buffer not initialized, recreating resources');

            if (histogramFilter && !histogramFilter.resources) {
                histogramFilter.resources = await renderer.pipelineManager.createFilterPipeline(histogramFilter);

                if (!histogramFilter?.resources?.buffer) {
                    throw new Error('Histogram buffer could not be recreated');
                }
            }
        }

        try {
            const sourceBuffer = histogramFilter.resources.buffers?.histogram ||
                histogramFilter.resources.buffer;

            // Create buffer for reading data
            const readBackBuffer = renderer.device.createBuffer({
                size: 256 * Float32Array.BYTES_PER_ELEMENT,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                label: 'Histogram ReadBack Buffer'
            });

            // Create and execute command encoder
            const commandEncoder = renderer.device.createCommandEncoder({
                label: 'Read Histogram Values'
            });

            commandEncoder.copyBufferToBuffer(
                sourceBuffer,
                0,
                readBackBuffer,
                0,
                256 * Float32Array.BYTES_PER_ELEMENT
            );

            renderer.device.queue.submit([commandEncoder.finish()]);

            // Map and read the data
            await readBackBuffer.mapAsync(GPUMapMode.READ);
            const mappedRange = readBackBuffer.getMappedRange();
            const histogramData = new Uint32Array(mappedRange);

            // Copy the data to a regular array
            const histogram = Array.from(histogramData);

            // Cleanup
            readBackBuffer.unmap();
            readBackBuffer.destroy();

            return histogram;
        } catch (error) {
            console.error('Error reading histogram values, possible invalid buffer:', error);

            if (error.message && error.message.includes('Invalid Buffer')) {
                console.warn('Detected invalid buffer, triggering resource recreation');
                await renderer.createResources(renderer.imageArray[renderer.imageIndex]?.type === 'Video');
            }

            throw error;
        }
    }

    /**
     * Reads and analyzes histogram data from the GPU
     * @param {WebGpuRenderer} renderer - The WebGPU renderer instance
     * @returns {Promise<Object|null>} Histogram statistics
     */
    static async readAndAnalyzeHistogram(renderer) {
        try {
            const histogramFilter = renderer.filters.histogramCompute;
            if (!histogramFilter?.resources?.buffer) {
                throw new Error('Histogram buffer not initialized');
            }

            const histogramData = await this.readHistogramValues(renderer);

            if (!histogramData || histogramData.length === 0) {
                console.warn('No histogram data received');
                return null;
            }

            const stats = this.calculateStatistics(histogramData);
            stats.rawHistogram = histogramData;

            if (renderer.debug) {
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
}

export default Histogram