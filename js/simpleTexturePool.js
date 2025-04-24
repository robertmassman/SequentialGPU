class SimpleTexturePool {
    constructor(device) {
        this.device = device;
        this.availableTextures = new Map(); // descriptor hash -> texture[]
        
        // Add comprehensive memory tracking properties
        this.totalMemoryUsage = 0;      // Total memory usage in bytes
        this.activeMemoryUsage = 0;     // Memory used by active textures
        this.pooledMemoryUsage = 0;     // Memory used by pooled textures
        this.textureCount = {
            active: 0,                  // Number of active textures
            pooled: 0,                  // Number of pooled textures
            created: 0,                 // Total textures created
            reused: 0                   // Total textures reused
        };
    }

    /**
     * Get a texture descriptor hash for pooling
     */
    getDescriptorHash(descriptor) {
        const key = `${descriptor.format}_${descriptor.size.width}x${descriptor.size.height}` +
            `_${descriptor.usage}_${descriptor.sampleCount || 1}`;
        return key;
    }

    /**
     * Calculate memory usage for a texture based on its descriptor
     */
    calculateTextureMemoryUsage(descriptor) {
        const bytesPerPixel = this.getFormatSize(descriptor.format);
        const width = descriptor.size.width;
        const height = descriptor.size.height;
        return width * height * bytesPerPixel;
    }

    /**
     * Get a texture from the pool or create a new one
     */
    acquire(descriptor) {
        const key = this.getDescriptorHash(descriptor);
        const available = this.availableTextures.get(key) || [];
        const memoryUsage = this.calculateTextureMemoryUsage(descriptor);

        if (available.length > 0) {
            // Reuse an existing texture from the pool
            const texture = available.pop();
            
            // Update memory tracking
            this.pooledMemoryUsage -= memoryUsage;
            this.activeMemoryUsage += memoryUsage;
            this.textureCount.pooled--;
            this.textureCount.active++;
            this.textureCount.reused++;
            
            return texture;
        }

        // Create new texture if none available
        const texture = this.device.createTexture(descriptor);
        
        // Store descriptor and memory usage on texture for tracking
        texture.descriptor = {...descriptor}; // Clone to avoid reference issues
        texture._memoryUsage = memoryUsage;
        
        // Update memory tracking
        this.totalMemoryUsage += memoryUsage;
        this.activeMemoryUsage += memoryUsage;
        this.textureCount.active++;
        this.textureCount.created++;
        
        return texture;
    }

    /**
     * Return a texture to the pool for reuse
     */
    release(texture) {
        if (!texture || !texture.descriptor) {
            return;
        }

        const key = this.getDescriptorHash(texture.descriptor);
        const available = this.availableTextures.get(key) || [];
        const memoryUsage = texture._memoryUsage || 0;
        
        // Update memory tracking
        this.activeMemoryUsage -= memoryUsage;
        this.pooledMemoryUsage += memoryUsage;
        this.textureCount.active--;
        this.textureCount.pooled++;
        
        available.push(texture);
        this.availableTextures.set(key, available);
    }

    /**
     * Get bytes per pixel for a format
     */
    getFormatSize(format) {
        switch(format) {
            case 'r8unorm': 
            case 'r8snorm': 
            case 'r8uint':
            case 'r8sint':
                return 1;
            case 'r16uint':
            case 'r16sint':
            case 'r16float':
            case 'rg8unorm':
            case 'rg8snorm':
                return 2;
            case 'r32float':
            case 'r32uint':
            case 'r32sint':
            case 'rg16float':
            case 'rgba8unorm':
            case 'rgba8unorm-srgb':
            case 'rgba8snorm':
            case 'bgra8unorm':
            case 'bgra8unorm-srgb':
                return 4;
            case 'rg32float':
            case 'rgba16float':
                return 8;
            case 'rgba32float':
                return 16;
            default:
                return 4; // Default to 4 bytes for unknown formats
        }
    }

    /**
     * Get current memory statistics
     */
    getMemoryStats() {
        return {
            totalBytes: this.totalMemoryUsage,
            activeBytes: this.activeMemoryUsage,
            pooledBytes: this.pooledMemoryUsage,
            megabytes: {
                total: (this.totalMemoryUsage / (1024 * 1024)).toFixed(2),
                active: (this.activeMemoryUsage / (1024 * 1024)).toFixed(2),
                pooled: (this.pooledMemoryUsage / (1024 * 1024)).toFixed(2)
            },
            textureCount: {
                active: this.textureCount.active,
                pooled: this.textureCount.pooled,
                total: this.textureCount.active + this.textureCount.pooled,
                created: this.textureCount.created,
                reused: this.textureCount.reused,
                reuseRate: this.textureCount.created > 0 ? 
                    (this.textureCount.reused / (this.textureCount.created + this.textureCount.reused)).toFixed(2) : "0.00"
            },
            formats: this.getFormatDistribution()
        };
    }
    
    /**
     * Get distribution of texture formats in the pool
     */
    getFormatDistribution() {
        const formats = {};
        for (const [key, textures] of this.availableTextures.entries()) {
            const format = key.split('_')[0];
            formats[format] = (formats[format] || 0) + textures.length;
        }
        return formats;
    }

    /**
     * Destroy all pooled textures
     */
    destroy() {
        for (const textures of this.availableTextures.values()) {
            for (const texture of textures) {
                // Update memory tracking before destroying
                this.totalMemoryUsage -= (texture._memoryUsage || 0);
                this.pooledMemoryUsage -= (texture._memoryUsage || 0);
                texture.destroy();
            }
        }
        
        // Reset tracking
        this.availableTextures.clear();
        this.textureCount.pooled = 0;
    }
}

export default SimpleTexturePool