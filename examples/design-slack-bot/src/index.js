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

  await client.chat.postMessage({
    channel: event.channel,
    text: formatCreationFallbackText(designRequest),
    unfurl_links: false,
    unfurl_media: false,
    blocks: buildCreationMessageBlocks(designRequest),
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
    ? 'On it! Creating a redesign for you.'
    : 'On it! Creating a design for you.';
}

function buildCreationMessageBlocks(designRequest) {
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
        text: `\n${formatCreationFallbackText(designRequest)}`,
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
  const response = await client.chat.postMessage({
    channel: event.channel,
    text: 'Your design is ready! Here are the details:',
    unfurl_links: false,
    unfurl_media: false,
    blocks: buildDesignResultBlocks({ prompt, designId, projects, project: firstProject }),
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

function buildDesignResultBlocks({ prompt, designId, projects, project, screenshotUrl }) {
  const imageUrl = screenshotUrl || project.screenshotUrl;
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Your design is ready! Here are the details:',
        emoji: true,
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
      if (error) {
        const details = stderr || stdout || error.message;
        reject(new Error(details.trim()));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
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
