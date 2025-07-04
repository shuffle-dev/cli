const chalk = require('chalk');
const ora = require('ora');
const config = require('../config');

class CleanupCommand {
    static async execute() {
        console.log(chalk.blue('🧹 Cleaning up invalid project locations'));
        console.log();

        const spinner = ora('Scanning projects...').start();

        try {
            const projects = config.getProjects();
            const projectEntries = Object.entries(projects);

            if (projectEntries.length === 0) {
                spinner.stop();
                console.log(chalk.yellow('No projects found to clean up.'));
                return;
            }

            let totalLocations = 0;
            let invalidLocations = 0;
            let cleanedProjects = 0;

            spinner.stop();
            console.log(chalk.gray(`Checking ${projectEntries.length} projects...`));
            console.log();

            for (const [projectId, project] of projectEntries) {
                const projectName = project.name || `project-${projectId.substring(0, 8)}...`;
                console.log(chalk.cyan(`Checking: ${projectName}`));

                // Handle new locations array format
                if (project.locations) {
                    const validLocations = await config.getValidLocations(projectId);
                    totalLocations += project.locations.length;
                    const invalidCount = project.locations.length - validLocations.length;

                    if (invalidCount > 0) {
                        invalidLocations += invalidCount;
                        cleanedProjects++;

                        // Show invalid locations
                        for (const location of project.locations) {
                            const exists = await require('fs-extra').pathExists(location.path);
                            if (!exists) {
                                console.log(chalk.red(`  ✗ Removed: ${location.path}`));
                            } else {
                                console.log(chalk.green(`  ✓ Valid: ${location.path}`));
                            }
                        }

                        await config.cleanupInvalidLocations(projectId);
                    } else {
                        console.log(chalk.green(`  ✓ All locations valid (${project.locations.length})`));
                    }
                }
                // Handle old localPath format
                else if (project.localPath) {
                    totalLocations++;
                    const exists = await require('fs-extra').pathExists(project.localPath);

                    if (!exists) {
                        invalidLocations++;
                        cleanedProjects++;
                        console.log(chalk.red(`  ✗ Removed: ${project.localPath}`));
                        config.removeProject(projectId);
                    } else {
                        console.log(chalk.green(`  ✓ Valid: ${project.localPath}`));
                    }
                }

                console.log();
            }

            console.log(chalk.green('✅ Cleanup completed!'));
            console.log();
            console.log(chalk.gray('Summary:'));
            console.log(chalk.gray(`  Total locations checked: ${totalLocations}`));
            console.log(chalk.gray(`  Invalid locations removed: ${invalidLocations}`));
            console.log(chalk.gray(`  Projects affected: ${cleanedProjects}`));

            if (invalidLocations > 0) {
                console.log();
                console.log(chalk.yellow('💡 Tip: Use "shuffle list" to see current project locations'));
            }

        } catch (error) {
            spinner.fail(chalk.red('Cleanup failed'));
            console.error(chalk.red('Error:', error.message));
            process.exit(1);
        }
    }
}

module.exports = CleanupCommand;
