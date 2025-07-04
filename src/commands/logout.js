const chalk = require('chalk');
const inquirer = require('inquirer');
const config = require('../config');

class LogoutCommand {
    static async execute() {
        const token = config.getToken();

        if (!token) {
            console.log(chalk.yellow('You are not currently authenticated.'));
            return;
        }

        console.log(chalk.blue('🔐 Shuffle CLI Logout'));
        console.log();

        const { confirmLogout } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirmLogout',
                message: 'Are you sure you want to logout?',
                default: false
            }
        ]);

        if (confirmLogout) {
            const success = config.removeToken();

            if (success) {
                console.log(chalk.green('✅ Successfully logged out!'));
                console.log(chalk.gray('Your authentication token has been removed.'));
            } else {
                console.log(chalk.red('❌ Failed to logout. Please try again.'));
                process.exit(1);
            }
        } else {
            console.log(chalk.gray('Logout cancelled.'));
        }
    }
}

module.exports = LogoutCommand;
