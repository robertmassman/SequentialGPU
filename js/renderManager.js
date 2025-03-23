class RenderManager {
    constructor(app) {
        this.app = app;
        this.settings = app.settings;
        this.animationFrameId = null;
        this.isRendering = false;
        this.autoThresholdEnabled = false;
    }

    updateOutputCanvas = async () => {

        // Ensure settings and canvas exist
        if (!this.settings?.outputCanvas?.[this.settings.layer.index]) {
            console.warn('Output canvas not properly initialized');
            return;
        }

        const drawToCanvas = {
            canvas: this.settings.outputCanvas[this.settings.layer.index].canvas,
            ctx: this.settings.outputCanvas[this.settings.layer.index].ctx
        };

        // Ensure canvas context exists
        if (!drawToCanvas.ctx) {
            drawToCanvas.ctx = drawToCanvas.canvas.getContext('2d');
        }

        const breakLoop = await this.updateFilters();

        if (breakLoop) {
            await this.updateHistogram();
        }

        // Update canvas dimensions and draw
        drawToCanvas.canvas.width = this.app.canvas.width;
        drawToCanvas.canvas.height = this.app.canvas.height;
        drawToCanvas.ctx.drawImage(this.app.canvas, 0, 0);

        // Continue or stop rendering based on result
        this.isRendering = !breakLoop;
        if (this.isRendering) {
            this.animationFrameId = requestAnimationFrame(this.updateOutputCanvas);
        }
    };

    async updateFilters() {
        for (const [key, filter] of Object.entries(this.settings.filters)) {
            if (!filter?.active) continue;

            if (['Gaussian Alpha Filter', 'Gaussian Beta Filter', 'Apply Filters',
                'Blend Filters', 'Threshold Filter'].includes(filter.label)) {
                if (filter.needsRender) {
                    this.updateDependentFilters(filter);
                    const breakLoop = await this.app.renderFilterPasses(filter);
                    filter.needsRender = false;
                    if (breakLoop) return true;
                }
            } else {
                const breakLoop = await this.app.renderFilterPasses(filter);
                if (breakLoop) return true;
            }
        }
        return false;
    }

    updateDependentFilters(filter) {
        switch (filter.label) {
            case 'Gaussian Alpha Filter':
            case 'Gaussian Beta Filter':
                if (!this.settings.filters['applyFilter'].active) {
                    this.settings.filters['blendFilter'].needsRender = true;
                } else {
                    this.settings.filters['applyFilter'].needsRender = true;
                }
                break;
            case 'Apply Filters':
                this.settings.filters['blendFilter'].needsRender = true;
                break;
            case 'Blend Filters':
                this.settings.filters['thresholdFilter'].needsRender = true;
                break;
        }
    }

    startRender() {
        console.log('Starting render loop', this.isRendering);
        if (!this.isRendering) {
            this.isRendering = true;
            this.animationFrameId = requestAnimationFrame(this.updateOutputCanvas);
        }
    }

    stopRender() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.isRendering = false;
    }

    async setAutoThreshold(enabled) {
        this.autoThresholdEnabled = enabled;
        await this.updateHistogram();
    }

    // Add callbacks for both histogram and threshold updates
    setHistogramUpdateCallback(callback) {
        this.onHistogramUpdate = callback;
    }

    setThresholdUpdateCallback(callback) {
        this.onThresholdUpdate = callback;
    }

    async updateThresholdFromHistogram(stats) {
        if (!stats || stats.median === null) {
            console.warn('Invalid histogram statistics for threshold update');
            return;
        }

        try {
            // Convert values to 0-1 range
            const normalizedMedian = stats.median / 255;
            const normalizedMax = stats.max / 255;
            const normalizedMin = stats.min / 255;

            // Calculate optimal threshold values
            const samplePoint = Math.max(0.001, Math.min(0.999, normalizedMedian));
            const range = Math.max(0.001, Math.min(1.0, normalizedMax - normalizedMin));

            // Update filter parameters
            await this.app.updateFilterBuffer('samplePoint', samplePoint);
            await this.app.updateFilterBuffer('range', range);

            // Mark threshold filter for update
            if (this.settings.filters.thresholdFilter) {
                this.settings.filters.thresholdFilter.needsRender = true;
            }

            return { samplePoint, range };
        } catch (error) {
            console.error('Error updating threshold from histogram:', error);
            throw error;
        }
    }

    async updateHistogram() {
        try {
            const stats = await this.app.readAndAnalyzeHistogram();
            if (stats) {
                if (this.autoThresholdEnabled) {
                    const thresholdValues = await this.updateThresholdFromHistogram(stats);
                    if (thresholdValues && this.onThresholdUpdate) {
                        this.onThresholdUpdate(thresholdValues);
                    }
                }
                if (this.onHistogramUpdate) {
                    this.onHistogramUpdate(stats);
                }
            }
        } catch (error) {
            console.error('Error updating histogram:', error);
        }
    }

}

export default RenderManager