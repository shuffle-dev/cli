const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

async function createShuffleDesign(designRequest, env = process.env) {
  const outputDir = path.join(process.cwd(), 'shuffle-output');
  await fs.mkdir(outputDir, { recursive: true });

  const outputFile = path.join(
    outputDir,
    `shuffle-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );

  const cliParts = shellWords(env.SHUFFLE_CLI || 'npx @shuffle-dev/cli');
  const [command, ...baseArgs] = cliParts;
  const modeCommand = designRequest.mode === 'redesign' ? 'redesign' : 'design';
  const args = [
    ...baseArgs,
    modeCommand,
    'create',
  ];

  if (designRequest.mode === 'redesign') {
    args.push(designRequest.sourceUrl);
  }

  if (designRequest.prompt) {
    args.push(designRequest.prompt);
  }

  args.push('--save-output', outputFile);

  if (env.SHUFFLE_SCREENSHOT !== 'false') {
    args.push('--screenshot');
  }

  if (env.SHUFFLE_ALL_MODELS === 'true') {
    args.push('--all');
  } else if (env.SHUFFLE_MODEL) {
    args.push('--model', env.SHUFFLE_MODEL);
  } else {
    throw new Error('Set SHUFFLE_MODEL or SHUFFLE_ALL_MODELS=true so the CLI can run non-interactively.');
  }

  const timeout = Number.parseInt(env.SHUFFLE_TIMEOUT_MS || '900000', 10);
  const { stdout, stderr } = await execFileAsync(command, args, { timeout, env });
  const output = await fs.readFile(outputFile, 'utf8');

  return {
    outputFile,
    cliOutput: `${stdout}\n${stderr}`.trim(),
    parsed: parseShuffleOutput(output),
  };
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: process.cwd(),
      timeout: options.timeout,
      maxBuffer: 1024 * 1024 * 5,
      env: options.env,
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
  const expiredAuthLine = output
    .split(/\r?\n/)
    .find((line) => line.includes('Your authentication has expired.'));
  if (expiredAuthLine) {
    return {
      message: expiredAuthLine.trim(),
      httpCode: null,
    };
  }

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

function parseShuffleOutput(output) {
  const session = output.match(/^Session:\s*(.+)$/m)?.[1] || null;
  const projects = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    const model = line.match(/^Model:\s*(.+)$/);
    if (model) {
      current = { model: model[1], editUrl: null, previewUrl: null, screenshotUrl: null };
      projects.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const edit = line.match(/^\s*Edit:\s*(.+)$/);
    const preview = line.match(/^\s*Preview:\s*(.+)$/);
    const screenshot = line.match(/^\s*Screenshot URL:\s*(.+)$/);

    if (edit) current.editUrl = edit[1];
    if (preview) current.previewUrl = preview[1];
    if (screenshot) current.screenshotUrl = screenshot[1];
  }

  return { session, projects };
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
  createShuffleDesign,
  parseShuffleOutput,
};
