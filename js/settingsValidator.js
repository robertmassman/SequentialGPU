class SettingsValidator {
    static validateSettings(settings) {
        if (!settings.presentationFormat) throw new Error('Presentation format is required.');
        if (!settings.textures) throw new Error('Textures are required.');
        if (!settings.filters) throw new Error('Filters are required.');

        this.validatePresentationFormat(settings.presentationFormat);
        this.validateTextures(settings.textures);
        this.validateFilters(settings.filters);
    }

    static validatePresentationFormat(format) {
        const validFormats = ['rgba8unorm', 'rgba8unorm-srgb', 'bgra8unorm', 'rgba16float'];
        if (!validFormats.includes(format)) {
            throw new Error(`Invalid presentation format: ${format}`);
        }
    }

    static validateTextures(textures) {
        if (!textures || Object.keys(textures).length === 0) {
            throw new Error('No textures defined in settings');
        }

        for (const [key, texture] of Object.entries(textures)) {
            // Validate required properties
            if (!texture.label) {
                throw new Error(`Texture ${key} missing required label property`);
            }

            // Validate format if specified
            if (texture.format) {
                this.validateTextureFormat(key, texture.format);
            }

            // Validate usage flags if specified
            if (texture.usage) {
                this.validateTextureUsage(key, texture.usage);
            }

            // Validate sample count if specified
            if (texture.sampleCount !== undefined) {
                this.validateSampleCount(key, texture.sampleCount);
            }

            // Validate size if specified
            if (texture.size) {
                this.validateTextureSize(key, texture.size);
            }
        }
    }

    static validateTextureFormat(textureKey, format) {
        const validFormats = [
            // Standard color formats
            'rgba8unorm',
            'rgba8unorm-srgb',
            'rgba8snorm',
            'rgba16float',
            'rgba32float',
            'bgra8unorm',
            'bgra8unorm-srgb',
        ];

        if (!validFormats.includes(format)) {
            throw new Error(
                'ValidationError',
                `Invalid texture format '${format}' for texture '${textureKey}'. ` +
                `Valid formats are: ${validFormats.join(', ')}`
            );
        }
    }

    static validateTextureUsage(textureKey, usage) {
        const validUsageFlags = {
            COPY_SRC: GPUTextureUsage.COPY_SRC,
            COPY_DST: GPUTextureUsage.COPY_DST,
            TEXTURE_BINDING: GPUTextureUsage.TEXTURE_BINDING,
            STORAGE_BINDING: GPUTextureUsage.STORAGE_BINDING,
            RENDER_ATTACHMENT: GPUTextureUsage.RENDER_ATTACHMENT
        };

        // Check if usage is a valid combination of flags
        let validCombination = false;
        let usedFlags = [];

        // Check each flag
        for (const [flagName, flagValue] of Object.entries(validUsageFlags)) {
            if (usage & flagValue) {
                usedFlags.push(flagName);
                validCombination = true;
            }
        }

        if (!validCombination) {
            throw new Error(
                `Invalid usage flags for texture '${textureKey}'. ` +
                `No valid usage flags found. Must include at least one of: ${Object.keys(validUsageFlags).join(', ')}`
            );
        }

        // Validate specific combinations
        if ((usage & GPUTextureUsage.STORAGE_BINDING) && (usage & GPUTextureUsage.RENDER_ATTACHMENT)) {
            throw new Error(
                `Invalid usage combination for texture '${textureKey}': ` +
                'STORAGE_BINDING cannot be combined with RENDER_ATTACHMENT'
            );
        }

        // Log used flags for debugging
        console.debug(`Texture '${textureKey}' uses flags: ${usedFlags.join(', ')}`);
    }

    static validateSampleCount(textureKey, sampleCount) {
        const validSampleCounts = [1, 4];

        if (!validSampleCounts.includes(sampleCount)) {
            throw new Error(
                `Invalid sample count '${sampleCount}' for texture '${textureKey}'. ` +
                `Valid sample counts are: ${validSampleCounts.join(', ')}`
            );
        }
    }

    static validateTextureSize(textureKey, size) {
        // Validate width
        if (!Number.isInteger(size.width) || size.width <= 0 || size.width > 16384) {
            throw new Error(
                `Invalid width '${size.width}' for texture '${textureKey}'. ` +
                'Width must be a positive integer not exceeding 16384'
            );
        }

        // Validate height
        if (!Number.isInteger(size.height) || size.height <= 0 || size.height > 16384) {
            throw new Error(
                `Invalid height '${size.height}' for texture '${textureKey}'. ` +
                'Height must be a positive integer not exceeding 16384'
            );
        }

        // Validate depthOrArrayLayers if specified
        if (size.depthOrArrayLayers !== undefined) {
            if (!Number.isInteger(size.depthOrArrayLayers) || size.depthOrArrayLayers <= 0 || size.depthOrArrayLayers > 2048) {
                throw new Error(
                    `Invalid depthOrArrayLayers '${size.depthOrArrayLayers}' for texture '${textureKey}'. ` +
                    'Must be a positive integer not exceeding 2048'
                );
            }
        }

    }

    static isPowerOf2(value) {
        return value > 0 && (value & (value - 1)) === 0;
    }

    static validateFilters(filters) {
        Object.entries(filters).forEach(([key, filter]) => {
            const requiredKeys = ['active', 'passes', 'bufferAttachment'];
            const missingKeys = requiredKeys.filter(k => !filter.hasOwnProperty(k));

            if (missingKeys.length > 0) {
                throw new Error(`Filter "${key}" missing required keys: ${missingKeys.join(', ')}`);
            }

            this.validateFilterPasses(key, filter.passes);
            this.validateBufferAttachment(key, filter.bufferAttachment);
        });
    }

    static validateFilterPasses(filterKey, passes) {
        if (!Array.isArray(passes)) {
            throw new Error(`Passes for filter "${filterKey}" must be an array`);
        }

        passes.forEach((pass, index) => {
            const requiredKeys = ['inputTexture', 'shaderURL'];
            const missingKeys = requiredKeys.filter(k => !pass.hasOwnProperty(k));

            if (missingKeys.length > 0) {
                throw new Error(
                    `Pass ${index} in filter "${filterKey}" missing required keys: ${missingKeys.join(', ')}`
                );
            }

            if (!Array.isArray(pass.inputTexture)) {
                throw new Error(
                    `InputTexture in pass ${index} of filter "${filterKey}" must be an array`
                );
            }
        });
    }

    static validateBufferAttachment(filterKey, attachment) {
        if (attachment) {
            if (attachment.groupIndex === undefined) {
                throw new Error(`Filter "${filterKey}" buffer attachment missing groupIndex`);
            }

            // Check for reserved binding indices
            if (attachment.bindingIndex !== undefined) {
                if (attachment.groupIndex === 0 && (attachment.bindingIndex === 0 || attachment.bindingIndex === 1)) {
                    throw new Error(
                        `Invalid binding configuration in filter "${filterKey}": ` +
                        'group index 0 and binding indices 0 and 1 are reserved'
                    );
                }
            }

            // Validate bindings if they exist
            if (attachment.bindings) {
                this.validateBindings(filterKey, attachment.bindings);
            }
        }
    }

    static validateBindings(filterKey, bindings) {
        Object.entries(bindings).forEach(([bindingKey, binding]) => {
            if (!binding.type) {
                throw new Error(
                    `Binding "${bindingKey}" in filter "${filterKey}" missing required type property`
                );
            }
            if (binding.value === undefined) {
                throw new Error(
                    `Binding "${bindingKey}" in filter "${filterKey}" missing required value property`
                );
            }
        });
    }
}

export default SettingsValidator;