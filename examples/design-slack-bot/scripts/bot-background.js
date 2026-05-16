#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const command = process.argv[2] || 'status';
const rootDir = path.resolve(__dirname, '..');
const runtimeDir = path.join(rootDir, '.runtime');
const pidFile = path.join(runtimeDir, 'bot.pid');
const logFile = path.join(runtimeDir, 'bot.log');

async function main() {
  if (command === 'start') {
    start();
    return;
  }

  if (command === 'stop') {
    await stop();
    return;
  }

  if (command === 'restart') {
    await stop({ quietIfMissing: true });
    start();
    return;
  }

  if (command === 'status') {
    status();
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error('Usage: node scripts/bot-background.js <start|stop|restart|status>');
  process.exit(1);
}

function start() {
  fs.mkdirSync(runtimeDir, { recursive: true });

  const existingPid = readPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`Bot is already running with PID ${existingPid}.`);
    return;
  }

  if (existingPid) {
    fs.rmSync(pidFile, { force: true });
  }

  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: rootDir,
    detached: true,
    env: process.env,
    stdio: ['ignore', logFd, logFd],
  });

  child.unref();
  fs.closeSync(logFd);
  fs.writeFileSync(pidFile, `${child.pid}\n`);
  console.log(`Bot started in the background with PID ${child.pid}.`);
  console.log(`Logs: ${logFile}`);
}

async function stop(options = {}) {
  const pid = readPid();
  if (!pid) {
    if (!options.quietIfMissing) {
      console.log('Bot is not running.');
    }
    return;
  }

  if (!isRunning(pid)) {
    fs.rmSync(pidFile, { force: true });
    if (!options.quietIfMissing) {
      console.log(`Removed stale PID file for PID ${pid}.`);
    }
    return;
  }

  process.kill(pid, 'SIGTERM');
  const stopped = await waitForExit(pid, 5000);

  if (stopped) {
    fs.rmSync(pidFile, { force: true });
    console.log(`Bot stopped PID ${pid}.`);
    return;
  }

  console.error(`Bot PID ${pid} did not stop within 5 seconds.`);
  console.error('Stop it manually or run: kill -TERM ' + pid);
  process.exitCode = 1;
}

function status() {
  const pid = readPid();

  if (!pid) {
    console.log('Bot is not running.');
    return;
  }

  if (!isRunning(pid)) {
    fs.rmSync(pidFile, { force: true });
    console.log(`Bot is not running. Removed stale PID file for PID ${pid}.`);
    return;
  }

  console.log(`Bot is running with PID ${pid}.`);
  console.log(`Logs: ${logFile}`);
}

function readPid() {
  try {
    const value = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = Number.parseInt(value, 10);
    return Number.isInteger(pid) ? pid : null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function waitForExit(pid, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isRunning(pid)) {
      return true;
    }

    await sleep(100);
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
