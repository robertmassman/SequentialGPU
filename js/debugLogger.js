class DebugLogger {
    constructor(enabled = false) {
        this.enabled = enabled;
        this.loggers = new Map();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
    }

    log(component, message, data = null) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${component}] ${message}`;

        if (data) {
            console.log(logMessage, data);
        } else {
            console.log(logMessage);
        }
    }

    warn(component, message, data = null) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${component}] ⚠️ ${message}`;

        if (data) {
            console.warn(logMessage, data);
        } else {
            console.warn(logMessage);
        }
    }

    error(component, message, error = null) {
        // Always log errors, regardless of debug setting
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${component}] 🚫 ${message}`;

        if (error) {
            console.error(logMessage, error);
        } else {
            console.error(logMessage);
        }
    }
}

export default DebugLogger