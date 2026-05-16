const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const api = require('../api');
const config = require('../config');
const endpoints = require('../config/endpoints');
const GetCommand = require('./get');

const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_MODEL_DELAY_MS = 100;

class DesignCommand {
    static register(program) {
        const design = program
            .command('design')
            .description('Create and manage Shuffle Design sessions');

        design
            .command('models')
            .description('List models available for Shuffle Design')
            .action(() => DesignCommand.models());

        design
            .command('create [prompt]')
            .description('Create a design session and generate a project')
            .option('-m, --model <id>', 'Model to generate with. Can be repeated or comma-separated.', DesignCommand.collectOption, [])
            .option('--all', 'Run all active design models without selecting them interactively')
            .option('--download [directory]', 'Download generated project files after each successful run')
            .option('--source-only', 'When used with --download, extract only source files')
            .option('--screenshot', 'Generate a screenshot for each project after it is created')
            .option('--save-output <file>', 'Save the output with all the URLs to a file')
            .action((prompt, options) => DesignCommand.create('design', { prompt }, options));

        design
            .command('sessions')
            .description('List your design and redesign sessions')
            .option('--page <number>', 'Page number', DesignCommand.parsePositiveInteger, 1)
            .option('--limit <number>', 'Items per page', DesignCommand.parsePositiveInteger, 20)
            .action((options) => DesignCommand.sessions(options));

        design
            .command('show <hash>')
            .description('Show design session details')
            .action((hash) => DesignCommand.show(hash));

        design
            .command('screenshot <projectSessionId>')
            .description('Generate or refresh a project screenshot')
            .action((projectSessionId) => DesignCommand.screenshot(projectSessionId));

        const redesign = program
            .command('redesign')
            .description('Create and run Shuffle Redesign sessions');

        redesign
            .command('create [url] [prompt]')
            .description('Create a redesign session and generate a project')
            .option('-m, --model <id>', 'Model to generate with. Can be repeated or comma-separated.', DesignCommand.collectOption, [])
            .option('--all', 'Run all active redesign-capable models without selecting them interactively')
            .option('--download [directory]', 'Download generated project files after each successful run')
            .option('--source-only', 'When used with --download, extract only source files')
            .option('--screenshot', 'Generate a screenshot for each project after it is created')
            .option('--save-output <file>', 'Save the output with all the URLs to a file')
            .action((url, prompt, options) => DesignCommand.create('redesign', { prompt, url }, options));
    }

    static async models() {
        DesignCommand.requireAuth();

        const spinner = ora('Fetching models...').start();

        try {
            const models = (await DesignCommand.fetchModels()).filter((model) => model.active !== false);
            spinner.stop();

            if (!models.length) {
                console.log(chalk.yellow('No active models found.'));
                return;
            }

            console.log(chalk.blue('Available Design Models'));
            console.log();

            models.forEach((model) => {
                const badges = [];
                if (model.default) {
                    badges.push(chalk.green('default'));
                }
                if (model.supports_redesign) {
                    badges.push(chalk.cyan('redesign'));
                }
                const suffix = badges.length ? ` ${chalk.gray(`[${badges.join(chalk.gray(', '))}]`)}` : '';
                console.log(`${chalk.cyan(model.id)} - ${model.label || model.id}${suffix}`);
            });
        } catch (error) {
            spinner.fail(chalk.red('Failed to fetch models'));
            DesignCommand.exitWithApiError(error);
        }
    }

    static async create(mode, payload, options) {
        DesignCommand.requireAuth();
        DesignCommand.validateModelOptions(options);
        const resolvedPayload = await DesignCommand.resolveCreatePayload(mode, payload);

        console.log(chalk.blue(mode === 'redesign' ? 'Creating redesign session' : 'Creating design session'));
        console.log();

        const spinner = ora('Creating session...').start();

        try {
            const session = await api.post(endpoints.aiDesignSessionsEndpoint, {
                mode,
                prompt: resolvedPayload.prompt,
                ...(mode === 'redesign' ? { url: resolvedPayload.url } : {}),
            }, { silentErrors: true });

            spinner.succeed(chalk.green('Session created'));
            DesignCommand.printSessionSummary(session);

            const output = options.saveOutput ? DesignCommand.createOutput(session) : null;

            await DesignCommand.runModelsForSession(mode, session.hash, options, output);
        } catch (error) {
            spinner.fail(chalk.red('Failed to create session'));
            DesignCommand.exitWithApiError(error);
        }
    }

    static async sessions(options) {
        DesignCommand.requireAuth();

        const spinner = ora('Fetching sessions...').start();

        try {
            const response = await api.get(endpoints.aiDesignSessionsEndpoint, {
                silentErrors: true,
                params: {
                    page: options.page,
                    limit: options.limit,
                },
            });
            spinner.stop();

            const sessions = DesignCommand.extractSessions(response);
            if (!sessions.length) {
                console.log(chalk.yellow('No design sessions found.'));
                return;
            }

            console.log(chalk.blue('Design Sessions'));
            console.log();

            sessions.forEach((session) => {
                const createdAt = session.createdAt ? new Date(session.createdAt).toLocaleString() : 'unknown date';
                const projectCount = Array.isArray(session.projects) ? session.projects.length : 0;
                console.log(`${chalk.cyan(session.hash)} ${chalk.gray(`[${session.mode || 'design'}]`)} ${session.prompt || ''}`);
                if (session.url) {
                    console.log(`  ${chalk.gray('URL:')} ${session.url}`);
                }
                console.log(`  ${chalk.gray('Created:')} ${createdAt}`);
                console.log(`  ${chalk.gray('Projects:')} ${projectCount}`);
                console.log();
            });

            DesignCommand.printPagination(response);
        } catch (error) {
            spinner.fail(chalk.red('Failed to fetch sessions'));
            DesignCommand.exitWithApiError(error);
        }
    }

    static async show(hash) {
        DesignCommand.requireAuth();

        const spinner = ora('Fetching session...').start();

        try {
            const session = await api.get(
                DesignCommand.endpointWithHash(endpoints.aiDesignSessionEndpoint, hash),
                { silentErrors: true },
            );
            spinner.stop();

            DesignCommand.printSessionDetails(session);
        } catch (error) {
            spinner.fail(chalk.red('Failed to fetch session'));
            DesignCommand.exitWithApiError(error);
        }
    }

    static async screenshot(projectSessionId) {
        DesignCommand.requireAuth();

        const spinner = ora('Generating screenshot...').start();

        try {
            const response = await DesignCommand.generateScreenshot(projectSessionId);
            spinner.succeed(chalk.green('Screenshot ready'));
            DesignCommand.printScreenshotResult(response, projectSessionId);
        } catch (error) {
            spinner.fail(chalk.red('Failed to generate screenshot'));
            DesignCommand.exitWithApiError(error);
        }
    }

    static async runModelsForSession(mode, hash, options, output = null) {
        const models = await DesignCommand.resolveModels(mode, options);
        if (!models.length) {
            console.log(chalk.yellow('No models selected.'));
            if (output) {
                await DesignCommand.saveOutputFile(output, options.saveOutput);
            }
            return;
        }

        console.log();
        console.log(chalk.blue(`Running ${models.length} model${models.length > 1 ? 's' : ''}...`));

        const spinner = ora(`Generating ${models.length} project${models.length > 1 ? 's' : ''}...`).start();

        const results = await Promise.allSettled(
            models.map(async (model, index) => {
                if (index > 0) {
                    await DesignCommand.delay(index * RUN_MODEL_DELAY_MS);
                }

                return DesignCommand.runSingleModel(hash, model);
            }),
        );

        const successfulProjects = [];
        const failedModels = [];
        results.forEach((result, index) => {
            const model = models[index];
            if (result.status === 'fulfilled') {
                const project = result.value.project;
                const item = { model, project };
                if (output) {
                    item.outputEntry = DesignCommand.addProjectToOutput(output, model, project);
                }
                successfulProjects.push(item);
            } else {
                failedModels.push({ model, error: result.reason });
            }
        });

        if (failedModels.length && successfulProjects.length) {
            spinner.warn(chalk.yellow(`Generated ${successfulProjects.length} project${successfulProjects.length > 1 ? 's' : ''}; ${failedModels.length} model${failedModels.length > 1 ? 's' : ''} failed.`));
        } else if (failedModels.length) {
            spinner.fail(chalk.red('All selected models failed.'));
        } else {
            spinner.succeed(chalk.green(`Generated ${successfulProjects.length} project${successfulProjects.length > 1 ? 's' : ''}.`));
        }

        successfulProjects.forEach((item) => {
            DesignCommand.printRunResult({ project: item.project, hash });
        });

        failedModels.forEach(({ model, error }) => {
            console.log();
            console.log(chalk.red(`Model failed: ${model.label || model.id} (${model.id})`));
            DesignCommand.printApiError(error);
        });

        if (options.download && successfulProjects.length) {
            await DesignCommand.downloadProjects(successfulProjects, options);
        }

        if (options.screenshot && successfulProjects.length) {
            await DesignCommand.generateScreenshotsForProjects(successfulProjects);
        }

        if (output) {
            await DesignCommand.saveOutputFile(output, options.saveOutput);
        }

        if (failedModels.length > 0 && successfulProjects.length === 0) {
            process.exit(1);
        }
    }

    static async runSingleModel(hash, model) {
        const response = await api.postStream(
            DesignCommand.endpointWithHash(endpoints.aiDesignRunsEndpoint, hash),
            { model: model.id },
            { timeout: RUN_TIMEOUT_MS, silentErrors: true },
        );

        return DesignCommand.parseRunStream(response);
    }

    static parseRunStream(response) {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let finalPayload = null;

            response.data.setEncoding('utf8');

            response.data.on('data', (chunk) => {
                buffer += chunk;
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';

                lines.forEach((line) => {
                    const payload = DesignCommand.parseRunStreamLine(line);
                    if (payload && typeof payload === 'object') {
                        finalPayload = payload;
                    }
                });
            });

            response.data.on('end', () => {
                const payload = DesignCommand.parseRunStreamLine(buffer);
                if (payload && typeof payload === 'object') {
                    finalPayload = payload;
                }

                if (!finalPayload) {
                    reject(new Error('Design run finished without a final response.'));
                    return;
                }

                if (finalPayload.status === false) {
                    const error = new Error(finalPayload.error || 'Design run failed.');
                    error.response = { data: finalPayload };
                    reject(error);
                    return;
                }

                resolve(finalPayload);
            });

            response.data.on('error', reject);
        });
    }

    static parseRunStreamLine(line) {
        const trimmed = String(line || '').trim();
        if (!trimmed) {
            return null;
        }

        try {
            const payload = JSON.parse(trimmed);
            return payload === 1 ? null : payload;
        } catch (error) {
            return null;
        }
    }

    static delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    static async generateScreenshot(projectSessionId) {
        return api.post(
            endpoints.aiDesignScreenshotEndpoint.replace('{sessionId}', encodeURIComponent(projectSessionId)),
            {},
            { timeout: RUN_TIMEOUT_MS, silentErrors: true },
        );
    }

    static async generateScreenshotsForProjects(projects) {
        console.log();
        console.log(chalk.blue('Generating screenshots...'));

        const spinner = ora(`Generating ${projects.length} screenshot${projects.length > 1 ? 's' : ''}...`).start();

        const results = await Promise.allSettled(
            projects.map((item) => DesignCommand.generateScreenshot(item.project.id)),
        );

        const successfulScreenshots = [];
        const failedScreenshots = [];

        results.forEach((result, index) => {
            const item = projects[index];
            if (result.status === 'fulfilled') {
                item.screenshotResult = result.value;
                successfulScreenshots.push({ item, response: result.value });
                return;
            }

            failedScreenshots.push({ item, error: result.reason });
        });

        if (failedScreenshots.length && successfulScreenshots.length) {
            spinner.warn(chalk.yellow(`Generated ${successfulScreenshots.length} screenshot${successfulScreenshots.length > 1 ? 's' : ''}; ${failedScreenshots.length} failed.`));
        } else if (failedScreenshots.length) {
            spinner.fail(chalk.red('Failed to generate screenshots.'));
        } else {
            spinner.succeed(chalk.green(`Generated ${successfulScreenshots.length} screenshot${successfulScreenshots.length > 1 ? 's' : ''}.`));
        }

        successfulScreenshots.forEach(({ item, response }) => {
            if (item.outputEntry && response.screenshot_url) {
                item.outputEntry.screenshotUrl = response.screenshot_url;
            }
            DesignCommand.printScreenshotResult(response, item.project.id);
        });

        failedScreenshots.forEach(({ item, error }) => {
            console.log();
            console.log(chalk.red(`Screenshot failed: ${item.project.id}`));
            DesignCommand.printApiError(error);
        });
    }

    static printScreenshotResult(response, projectSessionId) {
        console.log();
        console.log(`${chalk.gray('Project:')} ${response.project || projectSessionId}`);
        console.log(`${chalk.gray('Screenshot URL:')} ${response.screenshot_url || 'not returned'}`);
    }

    static createOutput(session) {
        return {
            session: session.hash,
            projects: [],
        };
    }

    static addProjectToOutput(output, model, project) {
        const entry = {
            modelName: project.model_label || model.label || project.model || model.id,
            editUrl: project.edit_url || null,
            previewUrl: project.preview_url || null,
            screenshotUrl: null,
        };

        output.projects.push(entry);

        return entry;
    }

    static async saveOutputFile(output, file) {
        const outputPath = path.resolve(file);
        await fs.ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, DesignCommand.formatOutputFile(output), 'utf8');

        console.log();
        console.log(`${chalk.green('Output saved:')} ${chalk.cyan(outputPath)}`);
    }

    static formatOutputFile(output) {
        const lines = [
            `Session: ${output.session || 'unknown'}`,
            '',
        ];

        output.projects.forEach((entry) => {
            lines.push(`Model: ${entry.modelName || 'unknown'}`);
            if (entry.editUrl) {
                lines.push(`  Edit: ${entry.editUrl}`);
            }
            if (entry.previewUrl) {
                lines.push(`  Preview: ${entry.previewUrl}`);
            }
            if (entry.screenshotUrl) {
                lines.push(`  Screenshot URL: ${entry.screenshotUrl}`);
            }
            lines.push('');
        });

        return `${lines.join('\n').trimEnd()}\n`;
    }

    static async downloadProjects(projects, options) {
        console.log();
        console.log(chalk.blue('Downloading generated projects...'));

        const multiple = projects.length > 1;
        for (const item of projects) {
            const projectId = item.project?.id;
            if (!projectId) {
                console.log(chalk.yellow(`Skipping download for ${item.model.id}: missing project id.`));
                continue;
            }

            const destination = DesignCommand.resolveDownloadDestination(options.download, item.model.id, multiple);
            await GetCommand.execute(projectId, destination, {
                output: undefined,
                sourceOnly: options.sourceOnly || false,
                rules: null,
            });
        }
    }

    static async resolveModels(mode, options) {
        const requestedModels = DesignCommand.getRequestedModels(options);
        const spinner = ora('Fetching model catalog...').start();

        try {
            const models = await DesignCommand.fetchModels();
            spinner.stop();

            const activeModels = models.filter((model) => model.active !== false);
            const allowedModels = mode === 'redesign'
                ? activeModels.filter((model) => model.supports_redesign)
                : activeModels;

            if (options.all) {
                if (!allowedModels.length) {
                    console.log(chalk.yellow(`No active ${mode} models found.`));
                }
                return allowedModels;
            }

            if (!requestedModels.length) {
                return DesignCommand.selectModelsInteractively(mode, allowedModels);
            }

            return DesignCommand.resolveRequestedModels(requestedModels, activeModels, allowedModels, mode);
        } catch (error) {
            spinner.fail(chalk.red('Failed to fetch model catalog'));
            throw error;
        }
    }

    static resolveRequestedModels(requestedModels, activeModels, allowedModels, mode) {
        const activeById = new Map(activeModels.map((model) => [model.id, model]));
        const allowedById = new Map(allowedModels.map((model) => [model.id, model]));
        const invalid = [];
        const unsupported = [];
        const resolved = [];

        requestedModels.forEach((modelId) => {
            if (!activeById.has(modelId)) {
                invalid.push(modelId);
                return;
            }

            if (!allowedById.has(modelId)) {
                unsupported.push(modelId);
                return;
            }

            resolved.push(allowedById.get(modelId));
        });

        if (invalid.length || unsupported.length) {
            if (invalid.length) {
                console.log(chalk.red(`Unknown or inactive model${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`));
            }
            if (unsupported.length) {
                console.log(chalk.red(`Model${unsupported.length > 1 ? 's do' : ' does'} not support ${mode}: ${unsupported.join(', ')}`));
            }
            console.log();
            console.log(chalk.gray('Current available models:'));
            allowedModels.forEach((model) => console.log(chalk.gray(`  ${model.id}`)));
            process.exit(1);
        }

        return resolved;
    }

    static async selectModelsInteractively(mode, allowedModels) {
        if (!allowedModels.length) {
            return [];
        }

        const answers = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'models',
                message: `Select ${mode} models to run:`,
                choices: allowedModels.map((model) => ({
                    name: `${model.label || model.id} (${model.id})`,
                    value: model.id,
                    checked: false,
                })),
                validate: (value) => {
                    if (!value.length) {
                        return 'Select at least one model.';
                    }

                    return true;
                },
            },
        ]);

        const selectedModelIds = new Set(answers.models);

        return allowedModels.filter((model) => selectedModelIds.has(model.id));
    }

    static async fetchModels() {
        const response = await api.get(endpoints.aiDesignModelsEndpoint, { silentErrors: true });
        return Array.isArray(response?.models) ? response.models : [];
    }

    static async resolveCreatePayload(mode, payload) {
        const resolvedPayload = { ...payload };

        if (
            mode === 'redesign'
            && resolvedPayload.url
            && !resolvedPayload.prompt
            && !DesignCommand.isHttpUrl(resolvedPayload.url)
        ) {
            resolvedPayload.prompt = resolvedPayload.url;
            resolvedPayload.url = null;
        }

        resolvedPayload.prompt = await DesignCommand.resolvePrompt(resolvedPayload.prompt);

        if (mode === 'redesign') {
            resolvedPayload.url = await DesignCommand.resolveUrl(resolvedPayload.url);
        }

        return resolvedPayload;
    }

    static async resolvePrompt(prompt) {
        const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        if (normalizedPrompt.length >= 10) {
            return normalizedPrompt;
        }

        if (normalizedPrompt.length > 0) {
            console.log(chalk.yellow('Prompt must be at least 10 characters long.'));
        }

        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'prompt',
                message: 'Describe what Shuffle should generate:',
                validate: (value) => {
                    if (String(value).trim().length < 10) {
                        return 'Prompt must be at least 10 characters long.';
                    }

                    return true;
                },
            },
        ]);

        return answers.prompt.trim();
    }

    static async resolveUrl(url) {
        const normalizedUrl = typeof url === 'string' ? url.trim() : '';
        if (DesignCommand.isHttpUrl(normalizedUrl)) {
            return normalizedUrl;
        }

        if (normalizedUrl.length > 0) {
            console.log(chalk.yellow('URL must be a valid http or https URL.'));
        }

        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'url',
                message: 'Website URL to redesign:',
                validate: (value) => {
                    if (!DesignCommand.isHttpUrl(String(value).trim())) {
                        return 'Enter a valid http or https URL.';
                    }

                    return true;
                },
            },
        ]);

        return answers.url.trim();
    }

    static isHttpUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch (error) {
            return false;
        }
    }

    static validateModelOptions(options) {
        if (options.all && DesignCommand.getRequestedModels(options).length) {
            console.log(chalk.red('Use either --all or --model, not both.'));
            process.exit(1);
        }
    }

    static requireAuth() {
        if (!config.getToken()) {
            console.log(chalk.red('❌ You are not authenticated. Please run "shuffle auth" first.'));
            process.exit(1);
        }
    }

    static collectOption(value, previous) {
        return previous.concat(value);
    }

    static getRequestedModels(options) {
        const values = Array.isArray(options.model) ? options.model : [];
        return [...new Set(
            values
                .flatMap((value) => String(value).split(','))
                .map((value) => value.trim())
                .filter(Boolean),
        )];
    }

    static parsePositiveInteger(value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new Error(`${value} is not a positive integer`);
        }
        return parsed;
    }

    static endpointWithHash(endpoint, hash) {
        return endpoint.replace('{hash}', encodeURIComponent(hash));
    }

    static resolveDownloadDestination(downloadOption, modelId, multiple) {
        if (!downloadOption) {
            return undefined;
        }

        const safeModel = modelId.replace(/[^a-zA-Z0-9._-]+/g, '-');
        if (downloadOption === true) {
            return multiple ? path.resolve('.', safeModel) : undefined;
        }

        return multiple ? path.join(downloadOption, safeModel) : downloadOption;
    }

    static extractSessions(response) {
        if (Array.isArray(response)) {
            return response;
        }
        if (Array.isArray(response?.sessions)) {
            return response.sessions;
        }
        if (Array.isArray(response?.items)) {
            return response.items;
        }
        if (Array.isArray(response?.data)) {
            return response.data;
        }
        return [];
    }

    static printPagination(response) {
        const page = response?.page || response?.pagination?.page;
        const limit = response?.limit || response?.pagination?.limit;
        const total = response?.total || response?.pagination?.total;

        if (page || limit || total) {
            console.log(chalk.gray([
                page ? `page ${page}` : null,
                limit ? `limit ${limit}` : null,
                total ? `total ${total}` : null,
            ].filter(Boolean).join(', ')));
        }
    }

    static printSessionSummary(session) {
        console.log();
        console.log(`${chalk.gray('Hash:')} ${chalk.cyan(session.hash)}`);
        console.log(`${chalk.gray('Mode:')} ${session.mode || 'design'}`);
        if (session.url) {
            console.log(`${chalk.gray('URL:')} ${session.url}`);
        }
        if (Array.isArray(session.available_models) && session.available_models.length) {
            console.log(`${chalk.gray('Available models:')} ${session.available_models.join(', ')}`);
        }
    }

    static printSessionDetails(session) {
        DesignCommand.printSessionSummary(session);

        const projects = Array.isArray(session.projects) ? session.projects : [];
        if (!projects.length) {
            console.log();
            console.log(chalk.yellow('No projects generated yet.'));
            return;
        }

        console.log();
        console.log(chalk.blue('Projects'));
        projects.forEach((project) => {
            console.log();
            console.log(`${chalk.cyan(project.sessionId || project.id || project.project || 'unknown project')} ${chalk.gray(project.model || '')}`);
            if (project.model_label) {
                console.log(`  ${chalk.gray('Model used:')} ${project.model_label}`);
            }
            DesignCommand.printProjectUrls(project);
        });
    }

    static printRunResult(response) {
        console.log();
        console.log(`${chalk.green('Generated project:')} ${chalk.cyan(response.project?.id || 'unknown')}`);
        if (response.hash) {
            console.log(`${chalk.gray('Session:')} ${response.hash}`);
        }
        if (response.project?.model) {
            console.log(`${chalk.gray('Model:')} ${response.project.model_label || response.project.model}`);
        }
        DesignCommand.printProjectUrls(response.project || {});
    }

    static printProjectUrls(project) {
        if (project.edit_url) {
            console.log(`  ${chalk.gray('Edit:')} ${project.edit_url}`);
        }
        if (project.preview_url) {
            console.log(`  ${chalk.gray('Preview:')} ${project.preview_url}`);
        }
    }

    static exitWithApiError(error) {
        DesignCommand.printApiError(error);
        process.exit(1);
    }

    static printApiError(error) {
        if (error.response?.status === 401) {
            console.log(chalk.yellow('Your authentication has expired. Please run "shuffle auth" again.'));
            return;
        }

        const responseData = error.response?.data;
        const message = responseData?.error || responseData?.message || error.message;
        if (error.response?.status) {
            console.log(chalk.red(`HTTP ${error.response.status}: ${message}`));
        } else {
            console.log(chalk.red(`Error: ${message}`));
        }

        if (Array.isArray(responseData?.models) && responseData.models.length) {
            console.log();
            console.log(chalk.gray('Available models:'));
            responseData.models.forEach((model) => {
                console.log(chalk.gray(`  ${model.id || model}`));
            });
        }
    }
}

module.exports = DesignCommand;
