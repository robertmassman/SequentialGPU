import WebGPUError from "./webGPUError.js";

class ErrorHandler {
    static throwError(type, message, details = null) {
        throw new WebGPUError(type, message, details);
    }

    static validateTexture(key, texture, availableTextures = []) {
        if (!texture) {
            this.throwError(
                'TextureError',
                `Texture "${key}" not found. Available textures: ${availableTextures.join(', ')}`
            );
        }
    }

    static validateFilter(filterKey, filter, passIndex = null) {
        if (!filter) {
            this.throwError(
                'FilterError',
                `Filter "${filterKey}" not found`
            );
        }

        if (passIndex !== null) {
            const pass = filter.passes[passIndex];
            if (!pass) {
                this.throwError(
                    'FilterError',
                    `Pass ${passIndex} not found in filter "${filterKey}"`
                );
            }
        }
    }

    static validateBindings(filterKey, bindings) {
        Object.entries(bindings).forEach(([bindingKey, binding]) => {
            if (!binding.type) {
                this.throwError(
                    'BindingError',
                    `Binding "${bindingKey}" in filter "${filterKey}" missing required type property`
                );
            }
            if (binding.value === undefined) {
                this.throwError(
                    'BindingError',
                    `Binding "${bindingKey}" in filter "${filterKey}" missing required value property`
                );
            }
        });
    }

    static validateBufferAttachment(filterKey, attachment) {
        if (attachment) {
            if (attachment.groupIndex === undefined) {
                this.throwError(
                    'BufferError',
                    `Filter "${filterKey}" buffer attachment missing groupIndex`
                );
            }

            if (attachment.bindingIndex !== undefined) {
                if (attachment.groupIndex === 0 &&
                    (attachment.bindingIndex === 0 || attachment.bindingIndex === 1)) {
                    this.throwError(
                        'BufferError',
                        `Invalid binding configuration in filter "${filterKey}": group index 0 and binding indices 0 and 1 are reserved`
                    );
                }
            }
        }
    }

    static async handleAsyncOperation(operation, errorMessage) {
        try {
            return await operation();
        } catch (error) {
            this.throwError(
                'OperationError',
                errorMessage,
                error
            );
        }
    }

    static wrapAsync(operation, errorMessage) {
        return async (...args) => {
            try {
                return await operation(...args);
            } catch (error) {
                this.throwError(
                    'OperationError',
                    errorMessage,
                    error
                );
            }
        };
    }
}

export default ErrorHandler