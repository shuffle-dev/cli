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
                    if (error.response?.status === 401) {
                        console.error('Authentication failed. Please run "shuffle auth" to re-authenticate.');
                        process.exit(1);
                    }
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
            this.handleError(error);
            throw error;
        }
    }

    async post(endpoint, data = {}, options = {}) {
        this.initialize();
        try {
            const response = await this.client.post(endpoint, data, options);
            return response.data;
        } catch (error) {
            this.handleError(error);
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
            this.handleError(error);
            throw error;
        }
    }

    handleError(error) {
        if (error.response) {
            console.error(`API Error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
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
