class SimpleTexturePool {
    constructor(device) {
        this.device = device;
        this.availableTextures = new Map(); // descriptor hash -> texture[]
    }

    /**
     * Get a texture descriptor hash for pooling
     */
    getDescriptorHash(descriptor) {
        const key = `${descriptor.format}_${descriptor.size.width}x${descriptor.size.height}` +
            `_${descriptor.usage}_${descriptor.sampleCount}`;
        return key;
    }

    /**
     * Get a texture from the pool or create a new one
     */
    acquire(descriptor) {
        const key = this.getDescriptorHash(descriptor);
        const available = this.availableTextures.get(key) || [];

        if (available.length > 0) {
            return available.pop();
        }

        // Create new texture if none available
        return this.device.createTexture(descriptor);
    }

    /**
     * Return a texture to the pool for reuse
     */
    release(texture) {
        if (!texture.descriptor) {
            return;
        }

        const key = this.getDescriptorHash(texture.descriptor);
        const available = this.availableTextures.get(key) || [];
        available.push(texture);
        this.availableTextures.set(key, available);
    }

    /**
     * Destroy all pooled textures
     */
    destroy() {
        for (const textures of this.availableTextures.values()) {
            for (const texture of textures) {
                texture.destroy();
            }
        }
        this.availableTextures.clear();
    }

}

export default SimpleTexturePool