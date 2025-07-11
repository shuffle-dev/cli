const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const yauzl = require('yauzl');
const api = require('../api');
const config = require('../config');

class GetCommand {
    static async execute(projectId, destination, options) {
        // Check if user is authenticated
        const token = config.getToken();
        if (!token && projectId !== 'example-project') {
            console.log(chalk.red('❌ You are not authenticated. Please run "shuffle auth" first.'));
            process.exit(1);
        }

        console.log(chalk.blue(`📥 Downloading project: ${projectId}`));
        if (options.sourceOnly) {
            console.log(chalk.gray('📁 Source-only mode: extracting src/ and package files only'));
        }
        if (options.rules) {
            console.log(chalk.gray(`📋 Rules mode: fetching rules "${options.rules}"`));
        }
        console.log();

        // Determine output directory: option flag > destination param > current directory
        const outputDir = path.resolve(options.output || destination || '.');

        // Ensure output directory exists
        await fs.ensureDir(outputDir);

        const spinner = ora('Downloading project...').start();

        try {
            // Get project info first (if possible, otherwise use fallback)
            let projectInfo;
            try {
                projectInfo = await api.get(`/projects/${projectId}`);
            } catch (infoError) {
                // If we can't get project info, use basic info
                projectInfo = { name: `project-${projectId}`, description: '' };
                console.log(chalk.yellow('⚠️  Could not fetch project details, using basic info.'));
            }

            const projectName = projectInfo.name || `project-${projectId}`;

            // Determine final directory based on whether destination was provided
            let finalProjectDir;
            if (destination || options.output) {
                // If destination provided, extract directly to destination
                finalProjectDir = outputDir;
            } else {
                // If no destination, create subdirectory with sanitized project name
                const sanitizedProjectName = projectName.replace(/\s+/g, '_');
                finalProjectDir = path.join(outputDir, sanitizedProjectName);
            }

            spinner.text = `Downloading ${projectName}...`;

            // Download project as zip stream
            const response = await api.getStream(`/projects/${projectId}/download`);

            // Save zip file temporarily
            const tempZipPath = path.join(outputDir, `${projectId}.zip`);
            const writer = fs.createWriteStream(tempZipPath);

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            spinner.text = options.sourceOnly ?
                'Extracting source files only...' :
                'Extracting files...';

            // Extract zip file with optional source-only filtering
            await GetCommand.extractZip(tempZipPath, finalProjectDir, options.sourceOnly);

            // Clean up temp zip file
            await fs.remove(tempZipPath);

            // Fetch and save rules if specified
            let successfulRulesName = null;
            if (options.rules) {
                spinner.start(`Fetching rules: ${options.rules}...`);
                try {
                    const rulesContent = await api.get(`/rules/${options.rules}`);

                    // Create rules directory
                    let rulesFile = null;
                    if (options.rules === 'cursor') {
                        const rulesDir = path.join(finalProjectDir, `.${options.rules}`);
                        await fs.ensureDir(rulesDir);

                        // Save rules content
                        rulesFile = path.join(rulesDir, 'rules');
                        await fs.writeFile(rulesFile, rulesContent, 'utf8');
                    } else if (options.rules === 'windsurf') {
                        rulesFile = path.join(finalProjectDir, '.windsurfrules');
                        await fs.writeFile(rulesFile, rulesContent, 'utf8');
                    }

                    // Only set the rules name if successful
                    successfulRulesName = options.rules;

                    spinner.succeed(chalk.green(`Rules "${options.rules}" downloaded successfully!`));
                    console.log(chalk.gray(`Rules saved to: .${rulesFile}`));
                } catch (rulesError) {
                    spinner.warn(chalk.yellow(`Failed to fetch rules "${options.rules}"`));
                    if (rulesError.response?.status === 404) {
                        console.log(chalk.yellow(`Rules "${options.rules}" not found on server`));
                    } else {
                        console.log(chalk.yellow(`Error fetching rules: ${rulesError.message}`));
                    }
                    console.log(chalk.gray('Project downloaded without rules'));
                }
            }

            const projectData = {
                ...projectInfo
                // Remove sourceOnly and rules from project-level data
            };

            const locationOptions = {
                sourceOnly: options.sourceOnly || false,
                rules: successfulRulesName
            };

            config.addProject(projectId, projectData, finalProjectDir, locationOptions);

            spinner.succeed(chalk.green(`Project downloaded successfully!`));
            console.log();
            console.log(chalk.cyan(`Location: ${finalProjectDir}`));
            if (options.sourceOnly) {
                console.log(chalk.gray(`📁 Extracted sources only`));
            }
            if (successfulRulesName) {
                console.log(chalk.gray(`📋 Rules "${successfulRulesName}" applied`));
            }
            console.log(chalk.gray(`Project registered for future sync operations`));
            console.log();

            // Calculate relative path for cd command
            const relativePath = path.relative(process.cwd(), finalProjectDir);

            console.log(chalk.gray('To sync changes from Shuffle:'));
            console.log(chalk.gray(`  shuffle sync ${projectId}`));

        } catch (error) {
            spinner.fail(chalk.red('Failed to download project'));

            if (error.response?.status === 404) {
                console.log(chalk.yellow('Project not found. Check the project ID and try again.'));
            } else if (error.response?.status === 401) {
                console.log(chalk.yellow('Your authentication has expired. Please run "shuffle auth" again.'));
            } else {
                console.error(chalk.red('Error:', error.message));
            }
            process.exit(1);
        }
    }

    static extractZip(zipPath, outputDir, sourceOnly = false) {
        return new Promise((resolve, reject) => {
            yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
                if (err) return reject(err);

                let commonPrefix = null;

                zipfile.readEntry();

                zipfile.on('entry', (entry) => {
                    let fileName = entry.fileName;

                    // Always detect and strip common prefix (like 'shuffle/')
                    if (commonPrefix === null) {
                        // First entry - detect prefix
                        const parts = fileName.split('/');
                        if (parts.length > 1 && parts[0] !== '') {
                            commonPrefix = parts[0] + '/';
                        } else {
                            commonPrefix = '';
                        }
                    }

                    // Strip common prefix if it exists
                    if (commonPrefix && fileName.startsWith(commonPrefix)) {
                        fileName = fileName.substring(commonPrefix.length);
                    }

                    // Skip if fileName becomes empty after stripping
                    if (!fileName || fileName === '/') {
                        zipfile.readEntry();
                        return;
                    }

                    const entryPath = path.join(outputDir, fileName);

                    // Filter entries if sourceOnly is true
                    if (sourceOnly) {
                        // Check if it's a source file or package file
                        // Handle both direct paths and paths with project prefix
                        const isSourceFile = fileName.endsWith('package.json') ||
                            fileName.endsWith('package-lock.json') ||
                            fileName.endsWith('yarn.lock') ||
                            fileName.includes('/src/') ||
                            fileName.endsWith('/src') ||
                            fileName === 'src' ||
                            fileName.startsWith('src/');

                        if (!isSourceFile) {
                            zipfile.readEntry();
                            return;
                        }
                    }

                    if (/\/$/.test(fileName)) {
                        // Directory entry
                        fs.ensureDir(entryPath, (err) => {
                            if (err) return reject(err);
                            zipfile.readEntry();
                        });
                    } else {
                        // File entry
                        fs.ensureDir(path.dirname(entryPath), (err) => {
                            if (err) return reject(err);

                            zipfile.openReadStream(entry, (err, readStream) => {
                                if (err) return reject(err);

                                const writeStream = fs.createWriteStream(entryPath);
                                readStream.pipe(writeStream);

                                writeStream.on('close', () => {
                                    zipfile.readEntry();
                                });

                                writeStream.on('error', reject);
                                readStream.on('error', reject);
                            });
                        });
                    }
                });

                zipfile.on('end', resolve);
                zipfile.on('error', reject);
            });
        });
    }
}

module.exports = GetCommand;
