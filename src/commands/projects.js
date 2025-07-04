const chalk = require('chalk');
const ora = require('ora');
const api = require('../api');
const config = require('../config');

class ProjectsCommand {
    static async execute() {
        // Check if user is authenticated
        const token = config.getToken();
        if (!token) {
            console.log(chalk.red('❌ You are not authenticated. Please run "shuffle auth" first.'));
            process.exit(1);
        }

        console.log(chalk.blue('📁 Your Shuffle Projects'));
        console.log();

        const spinner = ora('Fetching projects...').start();

        try {
            const projects = await api.get('/projects');
            spinner.stop();

            if (!projects || projects.length === 0) {
                console.log(chalk.yellow('No projects found.'));
                return;
            }

            console.log(chalk.green(`Found ${projects.length} project${projects.length > 1 ? 's' : ''}:`));
            console.log();

            // Display projects in a table-like format
            projects.forEach((project, index) => {
                const number = chalk.gray(`${index + 1}.`);
                const name = chalk.cyan(project.name || 'Untitled Project');
                const id = chalk.gray(`(ID: ${project.id})`);
                const updated = project.updated_at ?
                    chalk.gray(`Last updated: ${new Date(project.updated_at).toLocaleDateString()}`) :
                    '';

                console.log(`${number} ${name} ${id}`);
                if (project.description) {
                    console.log(`   ${chalk.gray(project.description)}`);
                }
                if (updated) {
                    console.log(`   ${updated}`);
                }
                console.log();
            });

            console.log(chalk.gray('Use "shuffle get <projectId>" to download a project'));
            console.log(chalk.gray('Use "shuffle sync <projectId>" to sync a project with local files'));

        } catch (error) {
            spinner.fail(chalk.red('Failed to fetch projects'));

            if (error.response?.status === 401) {
                console.log(chalk.yellow('Your authentication has expired. Please run "shuffle auth" again.'));
            } else {
                console.error(chalk.red('Error:', error.message));
            }
            process.exit(1);
        }
    }
}

module.exports = ProjectsCommand;
