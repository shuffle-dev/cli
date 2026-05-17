const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const REDESIGN_PROMPT = [
  'Give this interface a complete modern refresh with better UX and stronger brand presence.',
  'Rework the layout, spacing, hierarchy, and component styling while keeping the content understandable.',
].join(' ');

async function createRedesign(prospect, options = {}) {
  const prompt = options.prompt || REDESIGN_PROMPT;
  const outputDir = path.join(process.cwd(), 'shuffle-output');
  await fs.mkdir(outputDir, { recursive: true });

  const outputFile = path.join(outputDir, buildOutputFileName(prospect));
  const cliParts = shellWords(process.env.SHUFFLE_CLI || 'npx @shuffle-dev/cli');
  const [command, ...baseArgs] = cliParts;
  const args = [
    ...baseArgs,
    'redesign',
    'create',
    prospect.url,
    prompt,
    '--save-output',
    outputFile,
  ];

  if (process.env.SHUFFLE_SCREENSHOT !== 'false') {
    args.push('--screenshot');
  }

  if (process.env.SHUFFLE_ALL_MODELS === 'true') {
    args.push('--all');
  } else if (process.env.SHUFFLE_MODEL) {
    args.push('--model', process.env.SHUFFLE_MODEL);
  } else {
    throw new Error('Set SHUFFLE_MODEL or SHUFFLE_ALL_MODELS=true so the CLI can run non-interactively.');
  }

  const timeout = Number.parseInt(process.env.SHUFFLE_TIMEOUT_MS || '900000', 10);
  await execFileAsync(command, args, { timeout });

  return outputFile;
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: process.cwd(),
      timeout: options.timeout,
      maxBuffer: 1024 * 1024 * 5,
      env: process.env,
    }, (error, stdout, stderr) => {
      const stdoutError = extractStdoutError(stdout);
      if (stdoutError) {
        const extractedError = new Error(stdoutError.message);
        if (stdoutError.httpCode) {
          extractedError.httpCode = stdoutError.httpCode;
        }

        reject(extractedError);
        return;
      }

      if (error) {
        const details = stderr || stdout || error.message;
        reject(new Error(details.trim()));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function extractStdoutError(stdout) {
  const output = String(stdout || '');
  const cliError = output.match(/^Error:\s*(.*?)(?:\r?\n(.*?)(?:\r?\n|$)|$)/m);
  if (cliError) {
    return {
      message: [cliError[1], cliError[2]].filter(Boolean).map((line) => line.trim()).join('\n'),
      httpCode: null,
    };
  }

  const httpError = output.match(/^HTTP\s+(\d{3}):\s*(.*?)(?:\r?\n(.*?)(?:\r?\n|$)|$)/m);
  if (httpError) {
    const httpCode = Number.parseInt(httpError[1], 10);
    return {
      message: [`HTTP ${httpCode}: ${httpError[2]}`, httpError[3]].filter(Boolean).map((line) => line.trim()).join('\n'),
      httpCode,
    };
  }

  return null;
}

function buildOutputFileName(prospect) {
  const url = new URL(prospect.url);
  const host = slugify(url.hostname.replace(/^www\./, ''));
  const email = slugify(prospect.email.split('@')[0]);
  return `${host}-${email}-${Date.now()}.txt`;
}

function slugify(value) {
  return String(value || 'prospect')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'prospect';
}

function shellWords(value) {
  const words = String(value || '').match(/"[^"]+"|'[^']+'|\S+/g) || [];
  return words.map((word) => {
    if (
      (word.startsWith('"') && word.endsWith('"'))
      || (word.startsWith("'") && word.endsWith("'"))
    ) {
      return word.slice(1, -1);
    }

    return word;
  });
}

module.exports = {
  REDESIGN_PROMPT,
  createRedesign,
};
