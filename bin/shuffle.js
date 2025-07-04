#!/usr/bin/env node

const { program } = require('commander');
const pkg = require('../package.json');
const AuthCommand = require('../src/commands/auth');
const LogoutCommand = require('../src/commands/logout');
const ProjectsCommand = require('../src/commands/projects');
const ListCommand = require('../src/commands/list');
const StatusCommand = require('../src/commands/status');
const CleanupCommand = require('../src/commands/cleanup');
const GetCommand = require('../src/commands/get');
const SyncCommand = require('../src/commands/sync');

// Check if running via npx or globally installed
const isRunningViaNpx = process.argv[1] && process.argv[1].includes('/_npx/');

let programName = 'shuffle';

if (isRunningViaNpx) {
    programName = 'npx @shuffle-dev/cli';
}

program
    .name(programName)
    .description('Shuffle Editor CLI tool')
    .version(pkg.version);

// Authentication command
program
    .command('auth')
    .description('Authenticate with Shuffle Editor')
    .action(AuthCommand.execute);

// Logout command
program
    .command('logout')
    .description('Logout from Shuffle Editor')
    .action(LogoutCommand.execute);

// List projects command
program
    .command('projects')
    .description('List your Shuffle projects')
    .action(ProjectsCommand.execute);

// List downloaded projects command
program
    .command('list')
    .description('List downloaded projects')
    .action(ListCommand.execute);

// Show current directory status command
program
    .command('status')
    .description('Show current directory project status')
    .action(StatusCommand.execute);

// Cleanup invalid project locations command
program
    .command('cleanup')
    .description('Remove invalid project locations')
    .action(CleanupCommand.execute);

// Get project command
program
    .command('get <projectId> [destination]')
    .description('Download a project')
    .option('-o, --output <directory>', 'Output directory (overrides destination param)')
    .option('--source-only', 'Get only source files of the project')
    .option('--rules <rulesName>', 'Get also AI rules')
    .action(GetCommand.execute);

// Sync project command
program
    .command('sync [projectId] [destination]')
    .description('Sync project with local files (interactive selection if no projectId provided)')
    .option('-d, --directory <directory>', 'Project directory (overrides destination param)')
    .action(SyncCommand.execute);

program.action(() => {
    console.log('');
    program.help();
});

program.parse();
