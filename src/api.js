const axios = require('axios');
const config = require('./config');

class ApiClient {
    constructor() {
        this.client = null;
        this.baseURL = null;
    }

    initialize() {
        if (!this.client) {
            this.baseURL = config.getApiBaseUrl();
            this.client = axios.create({
                baseURL: this.baseURL,
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            this.client.interceptors.request.use(
                (requestConfig) => {
                    const token = config.getToken();
                    if (token) {
                        requestConfig.headers.Authorization = `Bearer ${token}`;
                    }
                    return requestConfig;
                },
                (error) => {
                    return Promise.reject(error);
                }
            );

            this.client.interceptors.response.use(
                (response) => response,
                (error) => {
                    return Promise.reject(error);
                }
            );
        }
    }

    async get(endpoint, options = {}) {
        this.initialize();
        try {
            const response = await this.client.get(endpoint, options);
            return response.data;
        } catch (error) {
            if (!options.silentErrors) {
                this.handleError(error);
            }
            throw error;
        }
    }

    async post(endpoint, data = {}, options = {}) {
        this.initialize();
        try {
            const response = await this.client.post(endpoint, data, options);
            return response.data;
        } catch (error) {
            if (!options.silentErrors) {
                this.handleError(error);
            }
            throw error;
        }
    }

    async postStream(endpoint, data = {}, options = {}) {
        this.initialize();
        try {
            return await this.client.post(endpoint, data, {
                ...options,
                responseType: 'stream',
            });
        } catch (error) {
            if (error.response?.data?.on) {
                error.response.data = await this.readStream(error.response.data);
            }
            if (!options.silentErrors) {
                this.handleError(error);
            }
            throw error;
        }
    }

    async getStream(endpoint, options = {}) {
        this.initialize();
        try {
            const response = await this.client.get(endpoint, {
                ...options,
                responseType: 'stream'
            });
            return response;
        } catch (error) {
            if (!options.silentErrors) {
                this.handleError(error);
            }
            throw error;
        }
    }

    readStream(stream) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('end', () => {
                const content = Buffer.concat(chunks).toString('utf8');
                try {
                    resolve(JSON.parse(content));
                } catch (error) {
                    resolve(content);
                }
            });
            stream.on('error', reject);
        });
    }

    handleError(error) {
        if (error.response) {
            const responseData = error.response.data;
            const message = responseData?.error || responseData?.message || error.response.statusText;
            console.error(`API Error: ${error.response.status} - ${message}`);
        } else if (error.request) {
            console.error('Network Error: Unable to reach the server');
        } else {
            console.error('Error:', error.message);
        }
    }

    setBaseURL(url) {
        this.baseURL = url;
        if (this.client) {
            this.client.defaults.baseURL = url;
        }
        config.setApiBaseUrl(url);
    }
}

module.exports = new ApiClient();
