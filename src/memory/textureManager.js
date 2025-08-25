import SimpleTexturePool from "./simpleTexturePool.js";

class TextureManager {
    constructor(app) {
        this.device = app.device;
        this.presentationFormat = app.presentationFormat;
        this.texturePool = new SimpleTexturePool(this.device);
        this.activeTextures = new Map(); // Currently in-use textures
    }

    async copyVideoFrameToTexture(video, textureKey) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        return new Promise((resolve) => {
            video.requestVideoFrameCallback(() => {
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);
                this.copyImageToTexture(canvas, textureKey, {
                    width: video.videoWidth,
                    height: video.videoHeight
                });
                resolve();
            });
        });
    }
    /////////////////////// END VIDEO CODE ///////////////////////

    createTexture(key, descriptor) {
        // Release existing texture if any
        if (this.activeTextures.has(key)) {
            this.releaseTexture(key);
        }

        // Get texture from pool or create new one
        const texture = this.texturePool.acquire(descriptor);
        this.activeTextures.set(key, texture);
        return texture;
    }

    createTextures(settings) {
        try {
            for (const [key, textureSettings] of Object.entries(settings.textures)) {
                const descriptor = {
                    label: textureSettings.label || key,
                    size: textureSettings.size || {
                        width: settings.canvas.width,
                        height: settings.canvas.height,
                        depthOrArrayLayers: 1
                    },
                    format: textureSettings.format || this.presentationFormat,
                    usage: textureSettings.usage || (
                        GPUTextureUsage.TEXTURE_BINDING |
                        GPUTextureUsage.RENDER_ATTACHMENT |
                        GPUTextureUsage.COPY_SRC |
                        GPUTextureUsage.COPY_DST
                    ),
                    sampleCount: textureSettings.sampleCount || 1,
                };

                this.createTexture(key, descriptor);
            }
        } catch (error) {
            console.error('Error creating textures:', error);
            throw error;
        }
    }

    copyTextureToTexture(commandEncoder, source, destination, dimensions) {
        const sourceTexture = this.activeTextures.get(source);
        const destTexture = this.activeTextures.get(destination);

        if (!sourceTexture || !destTexture) {
            throw new Error('Source or destination texture not found');
        }

        if (commandEncoder) {
            commandEncoder.copyTextureToTexture(
                { texture: sourceTexture },
                { texture: destTexture },
                dimensions
            );
        } else {
            const encoder = this.device.createCommandEncoder();
            encoder.copyTextureToTexture(
                { texture: sourceTexture },
                { texture: destTexture },
                dimensions
            );
            this.device.queue.submit([encoder.finish()]);
        }
    }

    releaseTexture(key) {
        const texture = this.activeTextures.get(key);
        if (texture) {
            this.texturePool.release(texture);
            this.activeTextures.delete(key);
        }
    }

    getTexture(key) {
        try {

            const texture = this.activeTextures.get(key);
            return texture;

        } catch (error) {
            console.error(`Error getting texture "${key}" not found. Available textures keys include: ${texture}, ${Array.from(this.activeTextures.keys()).join(', ')}:`, error);
            throw error;
        }
    }

    async copyImageToTexture(image, textureKey, dimensions) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = dimensions.width;
            canvas.height = dimensions.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const imageBitmap = await createImageBitmap(canvas);

            const texture = this.getTexture(textureKey);
            this.device.queue.copyExternalImageToTexture(
                { source: imageBitmap, flipY: false },
                { texture },
                dimensions
            );
        } catch (error) {
            console.error(`Failed to copy image to texture ${textureKey}`, error);
            throw error;
        }
    }

    async destroyTextures() {
        // Release all active textures back to pool
        for (const [key] of this.activeTextures) {
            this.releaseTexture(key);
        }

        // Destroy the pool itself
        this.texturePool.destroy();
    }

}

export default TextureManager;