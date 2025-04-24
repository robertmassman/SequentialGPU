class AppStateCache {
    constructor() {
        this.cache = new Map();
        this.currentImageId = null;

        // Configure cache limits
        this.maxCacheSize = 5; // Maximum number of cached states
        this.cachePriority = new Map(); // Track usage for LRU eviction
    }

    async cacheAppState(imageId, app) {
        try {
            // Store current pipeline cache state
            const pipelineCacheState = app.pipelineManager.pipelineCacheManager.storeCacheState();
            // Create deep copy of relevant app state
            const cachedState = {
                timestamp: Date.now(),
                settings: structuredClone(app.settings),
                pipelineCache: pipelineCacheState,
                canvasSize: {
                    width: app.canvas.width,
                    height: app.canvas.height
                },
                imageMetadata: {
                    width: app.image.width,
                    height: app.image.height,
                    ratio: app.ratio
                },
                filterStates: this._captureFilterStates(app)
            };

            // Implement LRU cache eviction if needed
            if (this.cache.size >= this.maxCacheSize && !this.cache.has(imageId)) {
                this._evictLeastRecentlyUsed();
            }

            this.cache.set(imageId, cachedState);
            this.cachePriority.set(imageId, Date.now());
            this.currentImageId = imageId;

            return true;
        } catch (error) {
            console.error('Error caching app state:', error);
            return false;
        }
    }

    async restoreAppState(imageId, app) {
        const cachedState = this.cache.get(imageId);
        if (!cachedState) return false;

        try {
            // Update cache priority
            this.cachePriority.set(imageId, Date.now());
            this.currentImageId = imageId;

            // Restore canvas dimensions
            app.canvas.width = cachedState.canvasSize.width;
            app.canvas.height = cachedState.canvasSize.height;

            // Restore image metadata
            app.ratio = cachedState.imageMetadata.ratio;

            // Restore settings (excluding dynamic properties)
            this._restoreSettings(app, cachedState.settings);

            // Restore pipeline cache state
            await app.pipelineManager.pipelineCacheManager.restoreCacheState(
                cachedState.pipelineCache,
                cachedState.canvasSize
            );

            // Restore filter states
            this._restoreFilterStates(app, cachedState.filterStates);

            /*if (app.renderManager) {
                app.renderManager.isRendering = false;
                if (app.renderManager.animationFrameId) {
                    cancelAnimationFrame(app.renderManager.animationFrameId);
                    app.renderManager.animationFrameId = null;
                }
            }*/

            return true;
        } catch (error) {
            console.error('Error restoring app state:', error);
            return false;
        }
    }

    _captureFilterStates(app) {
        const filterStates = {};
        for (const [filterKey, filter] of Object.entries(app.settings.filters)) {
            filterStates[filterKey] = {
                active: filter.active,
                needsRender: filter.needsRender,
                passes: filter.passes.map(pass => ({
                    active: pass.active,
                    bindGroup: pass.bindGroup ? true : false // Just store if it exists
                }))
            };
        }
        return filterStates;
    }

    _restoreFilterStates(app, filterStates) {
        for (const [filterKey, state] of Object.entries(filterStates)) {
            const filter = app.settings.filters[filterKey];
            if (filter) {
                filter.active = state.active;
                filter.needsRender = state.needsRender;
                state.passes.forEach((passState, index) => {
                    if (filter.passes[index]) {
                        filter.passes[index].active = passState.active;
                    }
                });
            }
        }
    }

    _restoreSettings(app, cachedSettings) {
        // Restore only non-dynamic settings
        const excludeKeys = ['image', 'canvas', 'context', 'device'];
        for (const key in cachedSettings) {
            if (!excludeKeys.includes(key)) {
                app.settings[key] = cachedSettings[key];
            }
        }
    }

    _evictLeastRecentlyUsed() {
        let oldestTime = Date.now();
        let oldestId = null;

        for (const [id, time] of this.cachePriority.entries()) {
            if (time < oldestTime) {
                oldestTime = time;
                oldestId = id;
            }
        }

        if (oldestId) {
            this.cache.delete(oldestId);
            this.cachePriority.delete(oldestId);
        }
    }

    clearCache() {
        this.cache.clear();
        this.cachePriority.clear();
        this.currentImageId = null;
    }

    getCurrentImageId() {
        return this.currentImageId;
    }

    hasCachedState(imageId) {
        return this.cache.has(imageId);
    }

    getCacheSize() {
        return this.cache.size;
    }

    getCacheStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxCacheSize,
            cachedImages: Array.from(this.cache.keys()),
            currentImage: this.currentImageId
        };
    }
}

export default AppStateCache;