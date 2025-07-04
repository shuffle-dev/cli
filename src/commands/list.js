const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const config = require('../config');

class ListCommand {
    static async execute() {
        console.log(chalk.blue('📦 Downloaded Projects'));
        console.log();

        const projects = config.getProjects();
        const projectEntries = Object.entries(projects);

        if (projectEntries.length === 0) {
            console.log(chalk.yellow('No projects downloaded yet.'));
            console.log();
            console.log(chalk.gray('Use "shuffle get <projectId>" to download a project'));
            return;
        }

        console.log(chalk.green(`Found ${projectEntries.length} downloaded project${projectEntries.length > 1 ? 's' : ''}:`));
        console.log();

        for (const [projectId, project] of projectEntries) {
            const name = chalk.cyan(project.name || 'Untitled Project');
            const id = chalk.gray(`(${projectId.substring(0, 8)}...)`);

            console.log(`${name} ${id}`);

            if (project.description) {
                console.log(`   ${chalk.gray(project.description)}`);
            }

            // Handle new locations array format
            if (project.locations && project.locations.length > 0) {
                console.log(`   ${chalk.gray('Locations:')}`);

                for (const location of project.locations) {
                    const exists = await fs.pathExists(location.path);
                    const status = exists ? chalk.green('✓') : chalk.red('✗ (missing)');

                    console.log(`     ${status} ${location.path}`);

                    if (location.downloadedAt) {
                        const downloadDate = new Date(location.downloadedAt).toLocaleDateString();
                        console.log(`       ${chalk.gray('Downloaded:')} ${downloadDate}`);
                    }

                    if (location.lastSyncAt) {
                        const syncDate = new Date(location.lastSyncAt).toLocaleDateString();
                        console.log(`       ${chalk.gray('Last sync:')} ${syncDate}`);
                    }
                }
            }
            // Backward compatibility with old localPath format
            else if (project.localPath) {
                const exists = await fs.pathExists(project.localPath);
                const status = exists ? chalk.green('✓') : chalk.red('✗ (missing)');

                console.log(`   ${chalk.gray('Path:')} ${status} ${project.localPath}`);

                if (project.downloadedAt) {
                    const downloadDate = new Date(project.downloadedAt).toLocaleDateString();
                    console.log(`   ${chalk.gray('Downloaded:')} ${downloadDate}`);
                }

                if (project.lastSyncAt) {
                    const syncDate = new Date(project.lastSyncAt).toLocaleDateString();
                    console.log(`   ${chalk.gray('Last sync:')} ${syncDate}`);
                }
            }

            console.log();
        }

        console.log(chalk.gray('Commands:'));
        console.log(chalk.gray('  shuffle sync                 - Interactive project selection for sync'));
        console.log(chalk.gray('  shuffle sync <projectId>     - Sync specific project with remote'));
        console.log(chalk.gray('  shuffle get <projectId>      - Download project to new location'));
        console.log(chalk.gray('  shuffle cleanup              - Remove missing project locations'));
    }
}

module.exports = ListCommand;
