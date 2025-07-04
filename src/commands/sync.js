const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const crypto = require('crypto');
const yauzl = require('yauzl');
const api = require('../api');
const config = require('../config');

class SyncCommand {
    static async execute(projectId, destination, options) {
        // Check if user is authenticated
        const token = config.getToken();
        if (!token) {
            console.log(chalk.red('❌ You are not authenticated. Please run "shuffle auth" first.'));
            process.exit(1);
        }

        // If no projectId provided, let user choose from downloaded projects
        if (!projectId) {
            // First check if current directory contains a known project
            const currentDirProject = config.findProjectByPath('.');
            if (currentDirProject) {
                console.log(chalk.blue(`🔄 Found project in current directory: ${currentDirProject.name || 'Untitled Project'}`));
                const { useCurrentDir } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'useCurrentDir',
                        message: 'Sync this project?',
                        default: true
                    }
                ]);

                if (useCurrentDir) {
                    projectId = currentDirProject.projectId;
                    // User explicitly chose current directory, so use it directly
                    const projectDir = path.resolve('.');
                    console.log();

                    // Skip location selection and proceed directly to sync
                    await SyncCommand.performSync(projectId, projectDir, options);
                    return;
                } else {
                    console.log();
                }
            }

            // If still no projectId, show project selection
            if (!projectId) {
                const projects = config.getProjects();
                const projectEntries = Object.entries(projects);

                if (projectEntries.length === 0) {
                    console.log(chalk.yellow('No projects downloaded yet.'));
                    console.log(chalk.gray('Use "shuffle get <projectId>" to download a project first'));
                    process.exit(1);
                }

                console.log(chalk.blue('🔄 Select project to sync:'));
                console.log();

                // Prepare choices for inquirer
                const choices = [];
                for (const [id, project] of projectEntries) {
                    const validLocations = await config.getValidLocations(id);
                    const locationCount = validLocations.length;
                    const locationText = locationCount > 0 ?
                        `(${locationCount} location${locationCount > 1 ? 's' : ''})` :
                        '(no valid locations)';

                    choices.push({
                        name: `${project.name || 'Untitled Project'} ${chalk.gray(locationText)}`,
                        value: id,
                        disabled: locationCount === 0 ? 'No valid locations found' : false
                    });
                }

                if (choices.every(choice => choice.disabled)) {
                    console.log(chalk.red('❌ No projects with valid locations found.'));
                    console.log(chalk.gray('Run "shuffle cleanup" to remove invalid locations or download projects again.'));
                    process.exit(1);
                }

                const { selectedProjectId } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'selectedProjectId',
                        message: 'Which project would you like to sync?',
                        choices: choices
                    }
                ]);

                projectId = selectedProjectId;
                console.log();
            }
        }

        // Determine project directory with smart defaults
        let projectDir;

        if (options.directory || destination) {
            // Use explicitly provided directory
            projectDir = path.resolve(options.directory || destination);
        } else {
            // Try to find project in registry
            const validLocations = await config.getValidLocations(projectId);

            if (validLocations.length > 0) {
                if (validLocations.length === 1) {
                    projectDir = validLocations[0].path;
                    console.log(chalk.gray(`📍 Found project at: ${projectDir}`));
                } else {
                    // Multiple locations - let user choose
                    console.log(chalk.yellow(`Found ${validLocations.length} locations for this project:`));
                    validLocations.forEach((loc, index) => {
                        const lastSync = loc.lastSyncAt ?
                            new Date(loc.lastSyncAt).toLocaleDateString() :
                            'Never';
                        console.log(chalk.gray(`  ${index + 1}. ${loc.path} (Last sync: ${lastSync})`));
                    });

                    const { selectedLocation } = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'selectedLocation',
                            message: 'Which location would you like to sync?',
                            choices: validLocations.map((loc, index) => ({
                                name: `${loc.path} (Last sync: ${loc.lastSyncAt ? new Date(loc.lastSyncAt).toLocaleDateString() : 'Never'})`,
                                value: index
                            }))
                        }
                    ]);

                    projectDir = validLocations[selectedLocation].path;
                }
            } else {
                // Check if current directory contains this project
                const currentDirProject = config.findProjectByPath('.');
                if (currentDirProject && currentDirProject.projectId === projectId) {
                    projectDir = path.resolve('.');
                    console.log(chalk.gray(`📍 Using current directory for project ${projectId}`));
                } else {
                    projectDir = path.resolve('.');
                    console.log(chalk.yellow(`⚠️  Project not found in registry, using current directory`));
                    console.log(chalk.gray(`Tip: Use 'shuffle get ${projectId}' first to download the project`));
                }
            }
        }

        // Clean up any invalid locations for this project
        await config.cleanupInvalidLocations(projectId);

        // Perform the actual sync
        await SyncCommand.performSync(projectId, projectDir, options);
    }

    static async performSync(projectId, projectDir, options) {
        // Check if directory exists
        if (!await fs.pathExists(projectDir)) {
            console.log(chalk.red('❌ Project directory does not exist.'));
            console.log(chalk.yellow(`Directory: ${projectDir}`));
            process.exit(1);
        }

        // Get project info to check for location-specific settings
        const localProject = config.getProject(projectId);
        const locationSettings = config.getLocationSettings(projectId, projectDir);

        const isSourceOnly = locationSettings ? locationSettings.sourceOnly : false;
        const rulesName = locationSettings ? locationSettings.rules : null;

        console.log(chalk.blue(`🔄 Syncing project: ${projectId}`));
        console.log(chalk.gray(`Directory: ${projectDir}`));
        if (isSourceOnly) {
            console.log(chalk.gray('📁 Source-only mode: syncing src/ and package files only'));
        }
        if (rulesName) {
            console.log(chalk.gray(`📋 Rules mode: will apply rules "${rulesName}"`));
        }
        console.log();

        const spinner = ora('Fetching remote project...').start();

        try {
            // Get project info
            const projectInfo = await api.get(`/projects/${projectId}`);
            spinner.text = `Syncing ${projectInfo.name || `project-${projectId}`}...`;

            // Download project as zip stream to temp location
            const response = await api.getStream(`/projects/${projectId}/download`);

            const tempDir = path.join(require('os').tmpdir(), `shuffle-sync-${projectId}`);
            const tempZipPath = path.join(tempDir, 'project.zip');
            const tempExtractDir = path.join(tempDir, 'extracted');

            await fs.ensureDir(tempDir);

            // Save and extract remote project
            const writer = fs.createWriteStream(tempZipPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            await SyncCommand.extractZip(tempZipPath, tempExtractDir, isSourceOnly);

            // Fetch and update rules if specified
            if (rulesName) {
                spinner.text = `Fetching updated rules: ${rulesName}...`;
                try {
                    const rulesContent = await api.get(`/rules/${rulesName}`);

                    // Create rules directory in temp location
                    const rulesDir = path.join(tempExtractDir, `.${rulesName}`);
                    await fs.ensureDir(rulesDir);

                    // Save rules content
                    const rulesFile = path.join(rulesDir, 'rules');
                    await fs.writeFile(rulesFile, rulesContent, 'utf8');

                } catch (rulesError) {
                    // Don't fail sync if rules can't be fetched, just warn
                    console.log(chalk.yellow(`⚠️  Failed to fetch updated rules "${rulesName}": ${rulesError.message}`));
                }
            }

            spinner.stop();

            // Compare local and remote files
            const comparison = await SyncCommand.compareDirectories(projectDir, tempExtractDir, rulesName);

            console.log(chalk.green('✅ Sync analysis complete'));
            console.log();

            // Display changes summary
            SyncCommand.displaySyncSummary(comparison);

            if (comparison.hasChanges) {
                const { confirmSync } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'confirmSync',
                        message: 'Do you want to apply these changes?',
                        default: true
                    }
                ]);

                if (confirmSync) {
                    await SyncCommand.applySyncChanges(projectDir, tempExtractDir, comparison);

                    // Sync rules files separately if they exist
                    if (rulesName) {
                        const tempRulesDir = path.join(tempExtractDir, `.${rulesName}`);
                        const localRulesDir = path.join(projectDir, `.${rulesName}`);

                        if (await fs.pathExists(tempRulesDir)) {
                            await fs.ensureDir(localRulesDir);
                            await fs.copy(tempRulesDir, localRulesDir);
                        }
                    }

                    // Update project registry with sync info
                    config.updateProject(projectId, {
                        lastSyncAt: new Date().toISOString()
                    }, projectDir);

                    console.log(chalk.green('✅ Sync completed successfully!'));
                    if (isSourceOnly) {
                        console.log(chalk.gray('📁 Synced sources only'));
                    }
                    if (rulesName) {
                        console.log(chalk.gray(`📋 Applied rules "${rulesName}"`));
                    }
                } else {
                    console.log(chalk.yellow('Sync cancelled by user.'));
                }
            } else {
                console.log(chalk.green('✅ Project is already up to date!'));
                if (isSourceOnly) {
                    console.log(chalk.gray('📁 Sources only'));
                }
                if (rulesName) {
                    console.log(chalk.gray(`📋 Rules "${rulesName}" up to date`));
                }
            }

            // Clean up temp directory
            await fs.remove(tempDir);

        } catch (error) {
            spinner.fail(chalk.red('Failed to sync project'));

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

    static async compareDirectories(localDir, remoteDir, rulesName = null) {
        const comparison = {
            newFiles: [],
            modifiedFiles: [],
            deletedFiles: [],
            hasChanges: false
        };

        // Get all files from both directories
        const localFiles = await SyncCommand.getAllFiles(localDir);
        const remoteFiles = await SyncCommand.getAllFiles(remoteDir);

        // Filter out rules files from comparison
        const filterRulesFiles = (files) => {
            if (!rulesName) return files;
            return files.filter(file => !file.startsWith(`.${rulesName}/`));
        };

        const filteredLocalFiles = filterRulesFiles(localFiles);
        const filteredRemoteFiles = filterRulesFiles(remoteFiles);

        const localFilesSet = new Set(filteredLocalFiles);
        const remoteFilesSet = new Set(filteredRemoteFiles);

        // Find new files (in remote but not in local)
        for (const remoteFile of filteredRemoteFiles) {
            if (!localFilesSet.has(remoteFile)) {
                comparison.newFiles.push(remoteFile);
            }
        }

        // Find deleted files (in local but not in remote)
        for (const localFile of filteredLocalFiles) {
            if (!remoteFilesSet.has(localFile)) {
                comparison.deletedFiles.push(localFile);
            }
        }

        // Find modified files
        for (const file of filteredLocalFiles) {
            if (remoteFilesSet.has(file)) {
                const localFilePath = path.join(localDir, file);
                const remoteFilePath = path.join(remoteDir, file);

                const localHash = await SyncCommand.getFileHash(localFilePath);
                const remoteHash = await SyncCommand.getFileHash(remoteFilePath);

                if (localHash !== remoteHash) {
                    comparison.modifiedFiles.push(file);
                }
            }
        }

        comparison.hasChanges = comparison.newFiles.length > 0 ||
            comparison.modifiedFiles.length > 0 ||
            comparison.deletedFiles.length > 0;

        return comparison;
    }

    static async getAllFiles(dir) {
        const files = [];

        async function traverse(currentDir, relativePath = '') {
            const entries = await fs.readdir(currentDir);

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry);
                const relativeEntryPath = path.join(relativePath, entry);
                const stat = await fs.stat(fullPath);

                if (stat.isDirectory()) {
                    await traverse(fullPath, relativeEntryPath);
                } else {
                    files.push(relativeEntryPath);
                }
            }
        }

        await traverse(dir);
        return files;
    }

    static async getFileHash(filePath) {
        const content = await fs.readFile(filePath);
        return crypto.createHash('md5').update(content).digest('hex');
    }

    static displaySyncSummary(comparison) {
        if (comparison.newFiles.length > 0) {
            console.log(chalk.green(`📄 New files (${comparison.newFiles.length}):`));
            comparison.newFiles.forEach(file => {
                console.log(chalk.green(`  + ${file}`));
            });
            console.log();
        }

        if (comparison.modifiedFiles.length > 0) {
            console.log(chalk.yellow(`📝 Modified files (${comparison.modifiedFiles.length}):`));
            comparison.modifiedFiles.forEach(file => {
                console.log(chalk.yellow(`  ~ ${file}`));
            });
            console.log();
        }

        if (comparison.deletedFiles.length > 0) {
            console.log(chalk.red(`🗑️  Files to delete (${comparison.deletedFiles.length}):`));
            comparison.deletedFiles.forEach(file => {
                console.log(chalk.red(`  - ${file}`));
            });
            console.log();
        }
    }

    static async applySyncChanges(localDir, remoteDir, comparison) {
        const spinner = ora('Applying changes...').start();

        try {
            // Handle modified and new files
            for (const file of [...comparison.newFiles, ...comparison.modifiedFiles]) {
                const remotePath = path.join(remoteDir, file);
                const localPath = path.join(localDir, file);

                await fs.ensureDir(path.dirname(localPath));
                await fs.copy(remotePath, localPath);
            }

            // Handle deleted files with confirmation for each
            if (comparison.deletedFiles.length > 0) {
                spinner.stop();

                for (const file of comparison.deletedFiles) {
                    const { shouldDelete } = await inquirer.prompt([
                        {
                            type: 'confirm',
                            name: 'shouldDelete',
                            message: `Delete local file "${file}"?`,
                            default: false
                        }
                    ]);

                    if (shouldDelete) {
                        const localPath = path.join(localDir, file);
                        await fs.remove(localPath);
                        console.log(chalk.red(`Deleted: ${file}`));
                    } else {
                        console.log(chalk.gray(`Kept: ${file}`));
                    }
                }

                spinner.start('Finalizing sync...');
            }

            spinner.succeed('Changes applied successfully!');
        } catch (error) {
            spinner.fail('Failed to apply changes');
            throw error;
        }
    }
}

module.exports = SyncCommand;
