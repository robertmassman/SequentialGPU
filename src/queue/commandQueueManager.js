class CommandQueueManager {
    constructor(device) {
        this.device = device;
        this.pendingCommands = [];
        this.activeEncoder = null;
        this.isRecording = false;

        // Simplified configuration
        this.maxBatchSize = 100;  // Maximum commands per batch
    }

    beginRecording() {
        if (this.isRecording) return;

        this.isRecording = true;
        this.activeEncoder = this.device.createCommandEncoder();
    }

    addCommand(command) {
        if (!this.isRecording) {
            this.beginRecording();
        }

        try {
            command(this.activeEncoder);
            this.pendingCommands.push(command);

            // Auto-flush if batch size limit reached
            if (this.pendingCommands.length >= this.maxBatchSize) {
                this.flush();
            }
        } catch (error) {
            console.error('Error executing command:', error);
            throw error;
        }
    }

    addRenderPass(params) {
        this.addCommand(encoder => {
            const renderPass = encoder.beginRenderPass(params.descriptor);
            params.commands(renderPass);
            renderPass.end();
        });
    }

    addComputePass(params) {
        this.addCommand(encoder => {
            const computePass = encoder.beginComputePass(params.descriptor);
            params.commands(computePass);
            computePass.end();
        });
    }

    addTextureCopy(params) {
        this.addCommand(encoder => {
            encoder.copyTextureToTexture(
                params.source,
                params.destination,
                params.copySize
            );
        });
    }

    addBufferCopy(params) {
        this.addCommand(encoder => {
            encoder.copyBufferToBuffer(
                params.source,
                params.sourceOffset || 0,
                params.destination,
                params.destinationOffset || 0,
                params.size
            );
        });
    }

    async flush() {
        try {
            if (!this.isRecording || this.pendingCommands.length === 0) {
                return Promise.resolve();
            }

            const commandBuffer = this.activeEncoder.finish();
            this.device.queue.submit([commandBuffer]);

            this.pendingCommands = [];
            this.activeEncoder = null;
            this.isRecording = false;

            return this.device.queue.onSubmittedWorkDone();
        } catch (error) {
            console.error('Failed to flush command queue', error);
            throw error;
        }
    }

    dispose() {
        if (this.pendingCommands.length > 0) {
            this.flush().catch(console.error);
        }
    }
}

export default CommandQueueManager