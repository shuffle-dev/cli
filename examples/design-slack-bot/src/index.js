require('dotenv').config();

const { App, LogLevel } = require('@slack/bolt');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const requiredEnv = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: resolveSlackLogLevel(process.env.SLACK_LOG_LEVEL),
});

const generationQueue = [];
let isGenerationRunning = false;

app.event('app_mention', async ({ event, client, logger }) => {
  await handleDesignRequest({ event, client, logger });
});

app.event('message', async ({ event, client, logger }) => {
  if (!isDirectUserMessage(event)) {
    return;
  }

  await handleDesignRequest({ event, client, logger });
});

app.error(async (error) => {
  console.error('[slack:error]', error);
});

async function handleDesignRequest({ event, client, logger }) {
  const prompt = cleanPrompt(event.text);
  const designRequest = parseDesignRequest(prompt);

  console.log('[design] accepted request', {
    channel: event.channel,
    channel_type: event.channel_type,
    user: event.user,
    thread_ts: event.thread_ts,
    mode: designRequest.mode,
    source_url: designRequest.sourceUrl,
    prompt_length: prompt.length,
  });

  if (prompt.length < 10) {
    console.log('[design] rejected request: prompt too short', {
      channel: event.channel,
      user: event.user,
      prompt_length: prompt.length,
    });

    await client.chat.postMessage({
      channel: event.channel,
      text: 'Please include a design description with at least 10 characters.',
    });
    return;
  }

  const isQueued = isGenerationRunning || generationQueue.length > 0;
  generationQueue.push({ event, client, logger, prompt, designRequest });

  if (isQueued) {
    await client.chat.postMessage({
      channel: event.channel,
      text: `${formatUserMention(event)} added your design to the queue 👌 I’ll start working on it as soon as I finish the current one.`,
    });
  }

  processGenerationQueue().catch((error) => logger.error(error));
}

async function processGenerationQueue() {
  if (isGenerationRunning) {
    return;
  }

  isGenerationRunning = true;

  try {
    while (generationQueue.length > 0) {
      const job = generationQueue.shift();
      try {
        await runDesignGenerationJob(job);
      } catch (error) {
        job.logger.error(error);
        await sendGenerationFailureMessage(job, error);
      }
    }
  } finally {
    isGenerationRunning = false;
  }
}

async function runDesignGenerationJob({ event, client, logger, prompt, designRequest }) {
  await client.chat.postMessage({
    channel: event.channel,
    text: `${formatUserMention(event)}, ${formatCreationFallbackText(designRequest)}`,
    unfurl_links: false,
    unfurl_media: false,
    blocks: buildCreationMessageBlocks(designRequest, event),
  });

  try {
    console.log('[shuffle] starting design creation', {
      channel: event.channel,
      user: event.user,
      mode: designRequest.mode,
      source_url: designRequest.sourceUrl,
      prompt_length: prompt.length,
    });

    const result = await createShuffleDesign(designRequest);

    console.log('[shuffle] design creation finished', {
      channel: event.channel,
      user: event.user,
      output_file: result.outputFile,
      project_count: result.parsed.projects.length,
    });

    await sendFormattedDesignResult({ event, client, prompt, result });
  } catch (error) {
    logger.error(error);
    await client.chat.postMessage({
      channel: event.channel,
      text: `Shuffle design failed: ${error.message}`,
    });
  }
}

async function sendGenerationFailureMessage({ event, client }, error) {
  try {
    await client.chat.postMessage({
      channel: event.channel,
      text: `Shuffle design failed: ${error.message}`,
    });
  } catch {
    // Avoid blocking the queue if Slack rejects the failure notification.
  }
}

function parseDesignRequest(prompt) {
  const slackLink = prompt.match(/^<((?:https?:\/\/)[^>|]+)(?:\|[^>]+)?>(?:\s+(.*))?$/i);
  if (slackLink) {
    return {
      mode: 'redesign',
      sourceUrl: slackLink[1],
      prompt: slackLink[2] || '',
    };
  }

  const plainUrl = prompt.match(/^((?:https?:\/\/)\S+)(?:\s+(.*))?$/i);
  if (plainUrl) {
    return {
      mode: 'redesign',
      sourceUrl: plainUrl[1],
      prompt: plainUrl[2] || '',
    };
  }

  return {
    mode: 'design',
    sourceUrl: null,
    prompt,
  };
}

function formatCreationFallbackText(designRequest) {
  return designRequest.mode === 'redesign'
    ? 'on it! Creating a redesign for you.'
    : 'on it! Creating a design for you.';
}

function buildCreationMessageBlocks(designRequest, event) {
  const isRedesign = designRequest.mode === 'redesign';
  const fields = [];

  if (isRedesign) {
    fields.push({
      type: 'mrkdwn',
      text: `*Website URL:*\n<${designRequest.sourceUrl}|${escapeSlackText(designRequest.sourceUrl)}>`,
    });
  }

  fields.push({
    type: 'mrkdwn',
    text: '*Est. time:*\n3 minutes',
  });

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${formatUserMention(event)}, ${formatCreationFallbackText(designRequest)}`,
      },
    },
    {
      type: 'section',
      fields,
    },
  ];
}

async function sendFormattedDesignResult({ event, client, prompt, result }) {
  const { projects } = result.parsed;

  if (!projects.length) {
    await client.chat.postMessage({
      channel: event.channel,
      text: `Shuffle finished, but I could not find project URLs in the output file: ${result.outputFile}`,
    });
    return;
  }

  const designId = resolveDesignId(result.parsed);
  const [firstProject, ...threadProjects] = projects;
  const readyText = `${formatUserMention(event)}, your design is ready! Here are the details:`;
  const response = await client.chat.postMessage({
    channel: event.channel,
    text: readyText,
    unfurl_links: false,
    unfurl_media: false,
    blocks: buildDesignResultBlocks({ prompt, designId, projects, project: firstProject, readyText }),
  });

  for (const [index, project] of threadProjects.entries()) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: response.ts,
      text: `Preview from ${project.model}`,
      unfurl_links: false,
      unfurl_media: false,
      blocks: buildThreadPreviewBlocks(project, index + 2),
    });
  }
}

function buildDesignResultBlocks({ prompt, designId, projects, project, screenshotUrl, readyText }) {
  const imageUrl = screenshotUrl || project.screenshotUrl;
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: readyText || 'Your design is ready! Here are the details:',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*PROMPT:*\n>${escapeSlackText(prompt)}`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*AI Models:*\n${projects.map((item) => escapeSlackText(item.model)).join(', ')}`,
        },
        {
          type: 'mrkdwn',
          text: `*Design ID:*\n<https://shuffle.dev/ai-design/${encodeURIComponent(designId)}|${escapeSlackText(designId)}>`,
        },
      ],
    },
  ];

  if (imageUrl) {
    blocks.push(buildDesignPreviewImageBlock(imageUrl));
  }

  const previewButtons = projects
    .map((item, index) => buildPreviewButton(item, index + 1))
    .filter(Boolean);

  if (previewButtons.length) {
    blocks.push({
      type: 'actions',
      elements: previewButtons,
    });
  }

  return blocks;
}

function buildThreadPreviewBlocks(project, index) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeSlackText(project.model)} preview*`,
      },
    },
  ];

  if (project.screenshotUrl) {
    blocks.push(buildDesignPreviewImageBlock(project.screenshotUrl));
  }

  const previewButton = buildPreviewButton(project, index);
  if (previewButton) {
    blocks.push({
      type: 'actions',
      elements: [previewButton],
    });
  }

  return blocks;
}

function buildPreviewButton(project, index) {
  if (!project.previewUrl) {
    return null;
  }

  const button = {
    type: 'button',
    text: {
      type: 'plain_text',
      text: project.model,
      emoji: true,
    },
    url: project.previewUrl,
    action_id: `open_model_${index}_preview`,
    style: 'primary',
  };

  return button;
}

function buildDesignPreviewImageBlock(imageUrl) {
  return {
    type: 'image',
    image_url: imageUrl,
    alt_text: 'Design preview',
  };
}

function resolveDesignId(parsed) {
  if (parsed.session) {
    return parsed.session;
  }

  for (const project of parsed.projects) {
    const projectId = extractProjectId(project.previewUrl) || extractProjectId(project.editUrl);
    if (projectId) {
      return projectId;
    }
  }

  return 'unknown';
}

function extractProjectId(url) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const projectParam = parsedUrl.searchParams.get('project');
    if (projectParam) {
      return projectParam;
    }

    const preview = parsedUrl.pathname.match(/^\/preview\/([^/]+)/);
    return preview?.[1] || null;
  } catch {
    return null;
  }
}

function escapeSlackText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatUserMention(event) {
  return event.user ? `<@${event.user}>` : '@user';
}

function isDirectUserMessage(event) {
  return event.channel_type === 'im'
    && !event.subtype
    && !event.bot_id
    && Boolean(event.user);
}

function cleanPrompt(text) {
  return String(text || '')
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function createShuffleDesign(designRequest) {
  const outputDir = path.join(process.cwd(), 'shuffle-output');
  await fs.mkdir(outputDir, { recursive: true });

  const outputFile = path.join(
    outputDir,
    `shuffle-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );

  const cliParts = shellWords(process.env.SHUFFLE_CLI || 'npx @shuffle-dev/cli');
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
  const { stdout, stderr } = await execFileAsync(command, args, { timeout });
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

function resolveSlackLogLevel(value) {
  const normalized = String(value || 'INFO').toUpperCase();
  return LogLevel[normalized] || LogLevel.INFO;
}

(async () => {
  await app.start();
  console.log('Shuffle Slack bot is running.');
})();
