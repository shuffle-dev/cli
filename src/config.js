const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const endpoints = require('./config/endpoints');

class Config {
    constructor() {
        this.configDir = path.join(os.homedir(), '.shuffle-cli');
        this.configFile = path.join(this.configDir, 'config.json');
        this.tokenFile = path.join(this.configDir, 'token');
        this.projectsFile = path.join(this.configDir, 'projects.json');
        this.ensureConfigDir();
    }

    ensureConfigDir() {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
    }

    getConfig() {
        try {
            if (fs.existsSync(this.configFile)) {
                return JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error reading config:', error.message);
        }
        return {};
    }

    setConfig(config) {
        try {
            const currentConfig = this.getConfig();
            const newConfig = { ...currentConfig, ...config };
            fs.writeFileSync(this.configFile, JSON.stringify(newConfig, null, 2));
            return true;
        } catch (error) {
            console.error('Error writing config:', error.message);
            return false;
        }
    }

    getToken() {
        try {
            if (fs.existsSync(this.tokenFile)) {
                return fs.readFileSync(this.tokenFile, 'utf8').trim();
            }
        } catch (error) {
            console.error('Error reading token:', error.message);
        }
        return null;
    }

    setToken(token) {
        try {
            fs.writeFileSync(this.tokenFile, token);
            return true;
        } catch (error) {
            console.error('Error writing token:', error.message);
            return false;
        }
    }

    removeToken() {
        try {
            if (fs.existsSync(this.tokenFile)) {
                fs.unlinkSync(this.tokenFile);
            }
            return true;
        } catch (error) {
            console.error('Error removing token:', error.message);
            return false;
        }
    }

    getApiBaseUrl() {
        return endpoints.apiBaseUrl;
    }

    getAuthUrl() {
        return endpoints.authEndpoint;
    }

    getTokenUrl() {
        return endpoints.tokenEndpoint;
    }

    getUserEndpoint() {
        return endpoints.apiBaseUrl + endpoints.userEndpoint;
    }

    getProjectsEndpoint() {
        return endpoints.projectsEndpoint;
    }

    getDownloadEndpoint() {
        return endpoints.downloadEndpoint;
    }

    getCallbackPorts() {
        return endpoints.callbackPorts;
    }

    getAuthTimeout() {
        return endpoints.authTimeout;
    }

    setApiBaseUrl(url) {
        console.warn('API base URL is configured in endpoints.js and cannot be changed at runtime');
        return false;
    }

    getProjects() {
        try {
            if (fs.existsSync(this.projectsFile)) {
                return JSON.parse(fs.readFileSync(this.projectsFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error reading projects:', error.message);
        }
        return {};
    }

    addProject(projectId, projectInfo, localPath, locationOptions = {}) {
        try {
            const projects = this.getProjects();
            const absolutePath = path.resolve(localPath);

            if (!projects[projectId]) {
                projects[projectId] = {
                    id: projectId,
                    name: projectInfo.name || `project-${projectId}`,
                    description: projectInfo.description || '',
                    locations: [],
                    downloadedAt: new Date().toISOString(),
                    lastSyncAt: null,
                    ...projectInfo
                };
            } else {
                // Update existing project with new info (but not location-specific options)
                const { sourceOnly, rules, ...projectOnlyInfo } = projectInfo;
                projects[projectId] = {
                    ...projects[projectId],
                    ...projectOnlyInfo,
                    // Preserve existing metadata
                    id: projectId,
                    locations: projects[projectId].locations || []
                };
            }

            // Add new location if it doesn't exist
            const existingLocation = projects[projectId].locations?.find(loc => loc.path === absolutePath);
            if (!existingLocation) {
                if (!projects[projectId].locations) {
                    projects[projectId].locations = [];
                }
                projects[projectId].locations.push({
                    path: absolutePath,
                    downloadedAt: new Date().toISOString(),
                    lastSyncAt: null,
                    sourceOnly: locationOptions.sourceOnly || false,
                    rules: locationOptions.rules || null
                });
            } else {
                // Update existing location with new settings
                existingLocation.downloadedAt = new Date().toISOString();
                existingLocation.sourceOnly = locationOptions.sourceOnly || false;
                existingLocation.rules = locationOptions.rules || null;
            }

            fs.writeFileSync(this.projectsFile, JSON.stringify(projects, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving project:', error.message);
            return false;
        }
    }

    updateProject(projectId, updates, locationPath = null) {
        try {
            const projects = this.getProjects();
            if (projects[projectId]) {
                projects[projectId] = { ...projects[projectId], ...updates };

                if (locationPath && projects[projectId].locations) {
                    const absolutePath = path.resolve(locationPath);
                    const location = projects[projectId].locations.find(loc => loc.path === absolutePath);
                    if (location && updates.lastSyncAt) {
                        location.lastSyncAt = updates.lastSyncAt;
                    }
                }

                fs.writeFileSync(this.projectsFile, JSON.stringify(projects, null, 2));
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error updating project:', error.message);
            return false;
        }
    }

    getProject(projectId) {
        const projects = this.getProjects();
        return projects[projectId] || null;
    }

    removeProject(projectId) {
        try {
            const projects = this.getProjects();
            if (projects[projectId]) {
                delete projects[projectId];
                fs.writeFileSync(this.projectsFile, JSON.stringify(projects, null, 2));
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error removing project:', error.message);
            return false;
        }
    }

    findProjectByPath(localPath) {
        const projects = this.getProjects();
        const absolutePath = path.resolve(localPath);

        for (const [projectId, project] of Object.entries(projects)) {
            if (project.locations) {
                const location = project.locations.find(loc => loc.path === absolutePath);
                if (location) {
                    return {
                        projectId,
                        ...project,
                        currentLocation: location,
                        // Include location-specific settings for convenience
                        sourceOnly: location.sourceOnly || false,
                        rules: location.rules || null
                    };
                }
            }
            else if (project.localPath === absolutePath) {
                return { projectId, ...project };
            }
        }
        return null;
    }

    async getValidLocations(projectId) {
        const project = this.getProject(projectId);
        if (!project) return [];

        const validLocations = [];

        if (project.locations) {
            for (const location of project.locations) {
                if (await fs.pathExists(location.path)) {
                    validLocations.push(location);
                }
            }
        }
        else if (project.localPath && await fs.pathExists(project.localPath)) {
            validLocations.push({
                path: project.localPath,
                downloadedAt: project.downloadedAt,
                lastSyncAt: project.lastSyncAt
            });
        }

        return validLocations;
    }

    async cleanupInvalidLocations(projectId) {
        try {
            const projects = this.getProjects();
            const project = projects[projectId];

            if (!project || !project.locations) return false;

            const validLocations = [];
            for (const location of project.locations) {
                if (await fs.pathExists(location.path)) {
                    validLocations.push(location);
                }
            }

            projects[projectId].locations = validLocations;

            if (validLocations.length === 0) {
                delete projects[projectId];
            }

            fs.writeFileSync(this.projectsFile, JSON.stringify(projects, null, 2));
            return true;
        } catch (error) {
            console.error('Error cleaning up locations:', error.message);
            return false;
        }
    }

    removeProjectLocation(projectId, locationPath) {
        try {
            const projects = this.getProjects();
            const project = projects[projectId];

            if (!project) return false;

            const absolutePath = path.resolve(locationPath);

            if (project.locations) {
                project.locations = project.locations.filter(loc => loc.path !== absolutePath);

                if (project.locations.length === 0) {
                    delete projects[projectId];
                }
            } else if (project.localPath === absolutePath) {
                delete projects[projectId];
            }

            fs.writeFileSync(this.projectsFile, JSON.stringify(projects, null, 2));
            return true;
        } catch (error) {
            console.error('Error removing project location:', error.message);
            return false;
        }
    }

    getLocationSettings(projectId, locationPath) {
        const project = this.getProject(projectId);
        if (!project || !project.locations) return null;

        const absolutePath = path.resolve(locationPath);
        const location = project.locations.find(loc => loc.path === absolutePath);

        if (location) {
            return {
                sourceOnly: location.sourceOnly || false,
                rules: location.rules || null
            };
        }

        return null;
    }
}

module.exports = new Config();
