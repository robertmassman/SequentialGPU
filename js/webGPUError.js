class WebGPUError extends Error {
    constructor(type, message, details = null) {
        super(message);
        this.name = 'WebGPUError';
        this.type = type;
        this.details = details;
    }
}

export default WebGPUError