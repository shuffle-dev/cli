// Shuffle CLI Configuration
// This file contains all API endpoints and configuration for the Shuffle CLI
// These settings are the same for all users and should not be modified
const SHUFFLE_DOMAIN = process.env.SHUFFLE_DOMAIN ?? 'shuffle.dev';

const config = {
    // Base URLs
    baseUrl: `https://${SHUFFLE_DOMAIN}`,
    apiBaseUrl: `https://${SHUFFLE_DOMAIN}/cli`,

    // Authentication endpoints (absolute URLs)
    authEndpoint: `https://${SHUFFLE_DOMAIN}/cli/auth`,
    tokenEndpoint: `https://${SHUFFLE_DOMAIN}/cli/auth/token`,

    // API endpoints (relative to apiBaseUrl)
    userEndpoint: '/user',
    projectsEndpoint: '/projects',
    downloadEndpoint: '/projects/{id}/download',

    // Local server configuration for auth callback
    callbackPorts: [8080, 8081, 8082, 8083, 8084, 8085],
    authTimeout: 300000, // 5 minutes in milliseconds
};

module.exports = config;
