const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const config = require('../config');

class StatusCommand {
    static async execute() {
        console.log(chalk.blue('📍 Current Directory Status'));
        console.log();

        const currentDir = process.cwd();
        console.log(chalk.gray(`Directory: ${currentDir}`));
        console.log();

        // Check if current directory contains a known project
        const currentDirProject = config.findProjectByPath('.');

        if (currentDirProject) {
            console.log(chalk.green('✅ This directory contains a registered Shuffle project:'));
            console.log();

            const name = chalk.cyan(currentDirProject.name || 'Untitled Project');
            const id = chalk.gray(`(${currentDirProject.projectId.substring(0, 8)}...)`);
            console.log(`${name} ${id}`);

            if (currentDirProject.description) {
                console.log(`${chalk.gray('Description:')} ${currentDirProject.description}`);
            }

            if (currentDirProject.currentLocation) {
                const location = currentDirProject.currentLocation;

                if (location.downloadedAt) {
                    const downloadDate = new Date(location.downloadedAt).toLocaleDateString();
                    console.log(`${chalk.gray('Downloaded:')} ${downloadDate}`);
                }

                if (location.lastSyncAt) {
                    const syncDate = new Date(location.lastSyncAt).toLocaleDateString();
                    console.log(`${chalk.gray('Last sync:')} ${syncDate}`);
                } else {
                    console.log(`${chalk.gray('Last sync:')} Never`);
                }
            }

            console.log();
            console.log(chalk.gray('Available commands:'));
            console.log(chalk.gray(`  shuffle sync                 - Sync this project`));
            console.log(chalk.gray(`  shuffle sync ${currentDirProject.projectId.substring(0, 8)}...       - Sync this project explicitly`));

        } else {
            console.log(chalk.yellow('⚠️  This directory is not a registered Shuffle project.'));
            console.log();

            // Check if there are any downloaded projects
            const projects = config.getProjects();
            const projectCount = Object.keys(projects).length;

            if (projectCount > 0) {
                console.log(chalk.gray(`You have ${projectCount} downloaded project${projectCount > 1 ? 's' : ''}:`));
                console.log();
                console.log(chalk.gray('Available commands:'));
                console.log(chalk.gray('  shuffle list                 - Show all downloaded projects'));
                console.log(chalk.gray('  shuffle sync                 - Interactive project selection'));
                console.log(chalk.gray('  shuffle get <projectId>      - Download a project here'));
            } else {
                console.log(chalk.gray('No projects downloaded yet.'));
                console.log();
                console.log(chalk.gray('Available commands:'));
                console.log(chalk.gray('  shuffle auth                 - Authenticate with Shuffle Editor'));
                console.log(chalk.gray('  shuffle projects             - List available projects'));
                console.log(chalk.gray('  shuffle get <projectId>      - Download a project'));
            }
        }
    }
}

module.exports = StatusCommand;
