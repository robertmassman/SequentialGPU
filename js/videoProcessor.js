class VideoProcessor {
    constructor(app) {
        this.app = app;
        this.textureManager = app.textureManager;
        this.isProcessingVideo = false;
        this.videoElement = null;
        this.frameRequestId = null;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.isVideoReady = false;
        this.lastFrameTime = 0;
        this.handleFrame = undefined;

        // FPS control properties
        this.targetFPS = 30;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastDrawTime = 0;

        // Frame properties
        this.videoDuration = 0;
        this.frameRate = 30;
        this.frameDuration = 1 / this.frameRate;
        this.frameIndex = 0;
        this.frameCount = 0;
        this.startFrame = 0;
        this.endFrame = 0;
        this.currentFrameIndex = 0;
    }

    // In the VideoProcessor class, modify copyVideoFrameToTexture
    /*async copyVideoFrameToTexture(video, textureKey, dimensions) {
        if (!video || !this.canvas || !this.ctx) {
            console.error('Required resources not available');
            return;
        }

        // Clear the canvas first
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        return new Promise((resolve) => {
            const drawFrame = () => {
                try {
                    // Update canvas dimensions if needed
                    if (this.canvas.width !== dimensions.width ||
                        this.canvas.height !== dimensions.height) {
                        this.canvas.width = dimensions.width;
                        this.canvas.height = dimensions.height;
                    }

                    // Draw the video frame
                    this.ctx.drawImage(video, 0, 0, dimensions.width, dimensions.height);

                    // Copy to texture
                    this.app.textureManager.copyImageToTexture(
                        this.canvas,
                        textureKey,
                        dimensions
                    ).then(resolve);
                } catch (error) {
                    console.error('Error in drawFrame:', error);
                    resolve(); // Resolve anyway to prevent hanging
                }
            };

            if ('requestVideoFrameCallback' in video) {
                video.requestVideoFrameCallback(() => drawFrame());
            } else {
                drawFrame(); // Fallback if requestVideoFrameCallback is not available
            }
        });
    }*/
    async copyVideoFrameToTexture(video, textureKey, dimensions) {
        if (!video || !this.canvas || !this.ctx) {
            console.error('Required resources not available');
            return;
        }

        // Update canvas dimensions to match the target dimensions
        if (this.canvas.width !== dimensions.width ||
            this.canvas.height !== dimensions.height) {
            this.canvas.width = dimensions.width;
            this.canvas.height = dimensions.height;
        }

        // Clear the canvas first
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        return new Promise((resolve) => {
            const drawFrame = () => {
                try {
                    // Enable high-quality scaling
                    this.ctx.imageSmoothingEnabled = true;
                    this.ctx.imageSmoothingQuality = 'high';

                    // Draw the video frame with scaling
                    this.ctx.drawImage(
                        video,
                        0, 0,
                        video.videoWidth, video.videoHeight,    // Source dimensions
                        0, 0,
                        dimensions.width, dimensions.height     // Destination dimensions
                    );

                    // Copy to texture
                    this.app.textureManager.copyImageToTexture(
                        this.canvas,
                        textureKey,
                        dimensions
                    ).then(resolve);
                } catch (error) {
                    console.error('Error in drawFrame:', error);
                    resolve(); // Resolve anyway to prevent hanging
                }
            };

            if ('requestVideoFrameCallback' in video) {
                video.requestVideoFrameCallback(() => drawFrame());
            } else {
                drawFrame(); // Fallback if requestVideoFrameCallback is not available
            }
        });
    }


    async seekToFrame(frameIndex) {
        if (!this.videoElement || !this.isVideoReady) return;

        const frameTime = frameIndex * this.frameDuration;
        this.videoElement.currentTime = frameTime;

        await new Promise(resolve => {
            this.videoElement.onseeked = () => {
                this.ctx.drawImage(this.videoElement, 0, 0);
                resolve();
            };
        });

        await this.app.textureManager.copyImageToTexture(
            this.canvas,
            'texture',
            {
                width: this.videoElement.videoWidth,
                height: this.videoElement.videoHeight
            }
        );

        this.currentFrameIndex = frameIndex;
        this.app.renderManager.invalidateFilterChain();
        this.app.renderManager.startRender();
    }
    // In the VideoProcessor class, modify seekToFrame
    /*async seekToFrame(frameIndex) {
        console.log(`Attempting to seek to frame ${frameIndex}`);

        if (!this.videoElement || !this.isVideoReady) {
            console.warn('Video not ready for seeking');
            return;
        }

        // Ensure frameIndex is valid and not 0
        const safeFrameIndex = Math.max(1, Math.min(frameIndex, this.frameCount - 1));
        const frameTime = safeFrameIndex * this.frameDuration;

        try {
            // Set the current time
            this.videoElement.currentTime = frameTime;

            // Wait for the seek operation to complete
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Seek timeout')), 1000);

                const onSeeked = () => {
                    clearTimeout(timeout);
                    this.videoElement.removeEventListener('seeked', onSeeked);
                    resolve();
                };

                this.videoElement.addEventListener('seeked', onSeeked);
            });

            // Wait for a new frame and copy it
            await new Promise(resolve => {
                this.videoElement.requestVideoFrameCallback(async () => {
                    // Clear canvas and draw new frame
                    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    this.ctx.drawImage(this.videoElement, 0, 0);

                    // Copy frame to texture using actual video dimensions
                    await this.app.textureManager.copyImageToTexture(
                        this.canvas,
                        'texture',
                        {
                            width: this.canvas.width,
                            height: this.canvas.height
                        }
                    );

                    this.currentFrameIndex = safeFrameIndex;

                    // Force a new render
                    if (this.app.renderManager) {
                        this.app.renderManager.invalidateFilterChain();
                        this.app.renderManager.startRender();
                    }

                    resolve();
                });
            });

            console.log(`Successfully seeked to frame ${safeFrameIndex}`);

        } catch (error) {
            console.error('Error in seekToFrame:', error);
            // If seek fails, try next frame
            if (safeFrameIndex < this.frameCount - 1) {
                console.log('Attempting recovery by seeking to next frame');
                await this.seekToFrame(safeFrameIndex + 1);
            }
        }
    }*/

    setFrameRange(start, end) {
        let seekFrame = this.startFrame !== start ? this.startFrame : this.endFrame;
        this.startFrame = Math.max(0, Math.min(start, this.frameCount - 1));
        this.endFrame = Math.max(0, Math.min(end, this.frameCount));

        if (!this.isProcessingVideo) {
            this.seekToFrame(seekFrame);
        } else if (this.currentFrameIndex < this.startFrame || this.currentFrameIndex > this.endFrame) {
            this.currentFrameIndex = this.startFrame;
            this.seekToFrame(seekFrame);
        }
    }

    setFPS(fps) {
        this.targetFPS = Math.max(1, Math.min(60, fps));
        this.frameInterval = 1000 / this.targetFPS;
    }

    async loadVideo(videoUrl) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.crossOrigin = "anonymous";
            video.autoplay = false;
            video.muted = true;
            video.loop = true;

            const getFrameCount = async (video) => {
                return new Promise((resolve) => {
                    const checkFrames = async () => {
                        let frameCount = 0;

                        try {
                            if ('requestVideoFrameCallback' in video) {
                                let frameCounter = 0;
                                let lastTime = 0;
                                let knownFrameTimes = new Set();

                                const countFrames = new Promise((resolveCount) => {
                                    const countFrame = (now, metadata) => {
                                        const currentTime = metadata.mediaTime;

                                        if (currentTime < lastTime && currentTime < 0.1) {
                                            resolveCount(knownFrameTimes.size);
                                            return;
                                        }

                                        if (!knownFrameTimes.has(currentTime)) {
                                            frameCounter++;
                                            knownFrameTimes.add(currentTime);
                                        }

                                        lastTime = currentTime;
                                        video.requestVideoFrameCallback(countFrame);
                                    };
                                    video.requestVideoFrameCallback(countFrame);
                                });

                                const wasLooping = video.loop;
                                const wasPlaying = !video.paused;
                                const originalPlaybackRate = video.playbackRate;
                                const originalCurrentTime = video.currentTime;

                                video.muted = true;
                                video.loop = true;
                                video.currentTime = 0;
                                video.playbackRate = 1.0;
                                await video.play();

                                frameCount = await countFrames;

                                video.pause();
                                video.currentTime = originalCurrentTime;
                                video.loop = wasLooping;
                                video.playbackRate = originalPlaybackRate;
                                if (!wasPlaying) {
                                    video.pause();
                                }

                                if (frameCount > 0) {
                                    return frameCount;
                                }
                            }
                        } catch (error) {
                            console.warn('Frame counting with requestVideoFrameCallback failed:', error);
                        }
                    };

                    if (video.duration === Infinity || video.duration === 0) {
                        video.addEventListener('durationchange', async () => {
                            const frames = await checkFrames();
                            resolve(frames);
                        }, { once: true });
                    } else {
                        checkFrames().then(resolve);
                    }
                });
            };

            video.addEventListener('loadedmetadata', async () => {
                try {
                    this.videoDuration = video.duration;
                    this.frameCount = Math.floor(this.videoDuration * this.frameRate);
                    this.frameDuration = 1 / this.frameRate;

                    const frameCount = await getFrameCount(video);

                    if (frameCount > 0 && Math.abs(frameCount - this.frameCount) > 5) {
                        this.frameRate = Math.round(frameCount / video.duration) || 30;
                        this.frameDuration = 1 / this.frameRate;
                        this.frameCount = frameCount || Math.floor(video.duration * this.frameRate);
                    }

                    this.startFrame = 0;
                    this.endFrame = this.frameCount - 1;
                    this.currentFrameIndex = this.startFrame;

                    window.dispatchEvent(new CustomEvent('frameCountUpdated', {
                        detail: { frameCount: this.frameCount }
                    }));
                } catch (error) {
                    console.warn('Error calculating frame count:', error);
                    this.frameRate = 30;
                    this.frameDuration = 1 / this.frameRate;
                    this.frameCount = Math.floor(video.duration * this.frameRate);
                }
            });

            video.addEventListener('canplay', async () => {
                this.isVideoReady = true;
                if (!this.videoElement) {
                    this.videoElement = video;
                    this.canvas.width = video.videoWidth;
                    this.canvas.height = video.videoHeight;
                    await this.app.createResources(true);
                    resolve(video);
                }
            });

            video.onerror = reject;
            video.src = videoUrl;
            video.load();
        });
    }

    /*async startProcessing() {
        if (!this.isVideoReady || !this.videoElement || this.isProcessingVideo) {
            console.warn('Video not ready or already processing');
            return;
        }

        this.app.updateManager.setAnimating(true);
        this.isProcessingVideo = true;
        this.lastDrawTime = performance.now();
        this.videoElement.pause();

        this.currentFrameIndex = this.startFrame;
        this.videoElement.currentTime = this.currentFrameIndex * this.frameDuration;

        const processFrame = async (timestamp) => {
            if (!this.isProcessingVideo) return;

            if (timestamp - this.lastDrawTime >= this.frameInterval) {
                try {
                    const nextFrameTime = Math.min(
                        this.currentFrameIndex * this.frameDuration,
                        this.videoElement.duration - 0.001
                    );

                    if (isFinite(nextFrameTime) && nextFrameTime >= 0) {
                        this.videoElement.currentTime = nextFrameTime;

                        await new Promise(resolve => {
                            this.videoElement.onseeked = () => {
                                this.ctx.drawImage(this.videoElement, 0, 0);
                                resolve();
                            };
                        });

                        await this.app.textureManager.copyImageToTexture(
                            this.canvas,
                            'texture',
                            {
                                width: this.videoElement.videoWidth,
                                height: this.videoElement.videoHeight
                            }
                        );

                        this.currentFrameIndex++;
                        if (this.currentFrameIndex > this.endFrame) {
                            this.currentFrameIndex = this.startFrame;
                        }

                        this.app.renderManager.invalidateFilterChain();
                        this.app.renderManager.startRender();

                        this.lastDrawTime = timestamp;
                        this.lastFrameTime = nextFrameTime;
                    }
                } catch (error) {
                    console.error('Error processing frame:', error);
                }
            }

            this.frameRequestId = requestAnimationFrame(processFrame);
        };

        this.frameRequestId = requestAnimationFrame(processFrame);
    }*/
    async startProcessing() {
        if (!this.isVideoReady || !this.videoElement || this.isProcessingVideo) {
            console.warn('Video not ready or already processing');
            return;
        }

        this.app.updateManager.setAnimating(true);
        this.isProcessingVideo = true;
        this.lastDrawTime = performance.now();
        this.videoElement.pause();

        const processFrame = async (timestamp) => {
            if (!this.isProcessingVideo) return;

            if (timestamp - this.lastDrawTime >= this.frameInterval) {
                try {
                    // Only update the frame if we're not in the middle of filter processing
                    if (!this.app.renderManager.isProcessingFilters) {
                        const nextFrameTime = Math.min(
                            this.currentFrameIndex * this.frameDuration,
                            this.videoElement.duration - 0.001
                        );

                        if (isFinite(nextFrameTime) && nextFrameTime >= 0) {
                            this.videoElement.currentTime = nextFrameTime;

                            await new Promise(resolve => {
                                this.videoElement.onseeked = () => {
                                    this.ctx.drawImage(this.videoElement, 0, 0);
                                    resolve();
                                };
                            });

                            await this.app.textureManager.copyImageToTexture(
                                this.canvas,
                                'texture',
                                {
                                    width: this.videoElement.videoWidth,
                                    height: this.videoElement.videoHeight
                                }
                            );

                            this.currentFrameIndex++;
                            if (this.currentFrameIndex > this.endFrame) {
                                this.currentFrameIndex = this.startFrame;
                            }
                        }
                    }

                    // Always process filters on the current frame
                    this.app.renderManager.invalidateFilterChain();
                    this.app.renderManager.startRender();

                    this.lastDrawTime = timestamp;
                } catch (error) {
                    console.error('Error processing frame:', error);
                }
            }

            this.frameRequestId = requestAnimationFrame(processFrame);
        };

        this.frameRequestId = requestAnimationFrame(processFrame);
    }

    stopProcessing() {
        this.app.updateManager.setAnimating(false);
        this.isProcessingVideo = false;
        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.currentTime = this.startFrame * this.frameDuration;
        }
        if (this.frameRequestId !== null) {
            cancelAnimationFrame(this.frameRequestId);
            this.frameRequestId = null;
        }
        this.lastFrameTime = 0;
        this.lastDrawTime = 0;
        this.currentFrameIndex = this.startFrame;
    }

    dispose() {
        this.stopProcessing();

        if (this.frameRequestId) {
            cancelAnimationFrame(this.frameRequestId);
            this.frameRequestId = null;
        }

        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.src = '';
            this.videoElement.load();
            this.videoElement.remove();
            this.videoElement = null;
        }

        if (this.canvas) {
            this.ctx = null;
            this.canvas.width = 1;
            this.canvas.height = 1;
            this.canvas = null;
        }

        this.isVideoReady = false;
        this.lastFrameTime = 0;
        this.frameIndex = 0;
    }
}

export default VideoProcessor;