const { App, LogLevel } = require('@slack/bolt');
const { cleanPrompt, parseDesignRequest } = require('./design-request');

const SLACK_RECONNECT_INTERVAL_MS = 30 * 1000;

function createSlackApp(env = process.env) {
  return new App({
    token: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: resolveSlackLogLevel(env.SLACK_LOG_LEVEL),
  });
}

function registerSlackHandlers(app, { createShuffleDesign }) {
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
}

function createSlackLifecycle(app) {
  let slackReconnectTimer = null;
  let isSlackSocketStarting = false;
  let isSlackSocketRestarting = false;
  let isSlackSocketStopping = false;

  installSlackSocketReconnectGuard();

  async function startSlackBot() {
    if (isSlackSocketStarting) {
      return;
    }

    isSlackSocketStarting = true;
    try {
      await app.start();
      console.log('Shuffle Slack bot is running.');
    } catch (error) {
      console.error('[slack:socket-mode] Failed to start Slack socket:', error);
      scheduleSlackReconnect(error);
    } finally {
      isSlackSocketStarting = false;
    }
  }

  function installSlackSocketReconnectGuard() {
    const client = getSlackSocketModeClient(app);
    if (!client) {
      return;
    }

    patchSlackSocketStateMachine(client);

    client.on('disconnected', (error) => {
      if (isSlackSocketStopping || isSlackSocketRestarting) {
        return;
      }

      scheduleSlackReconnect(error || new Error('Slack Socket Mode disconnected.'));
    });

    client.on('unable_to_socket_mode_start', (error) => {
      scheduleSlackReconnect(error);
    });
  }

  function patchSlackSocketStateMachine(client) {
    if (!client.stateMachine || typeof client.stateMachine.handle !== 'function') {
      return;
    }

    const originalHandle = client.stateMachine.handle.bind(client.stateMachine);
    client.stateMachine.handle = (event, payload) => {
      try {
        return originalHandle(event, payload);
      } catch (error) {
        if (!isUnhandledConnectingDisconnect(error)) {
          throw error;
        }

        console.error('[slack:socket-mode] Slack disconnected while connecting; retrying in 30 seconds.');
        scheduleSlackReconnect(error);
        return undefined;
      }
    };
  }

  function isUnhandledConnectingDisconnect(error) {
    return error instanceof Error
      && error.message.includes("Unhandled event 'server explicit disconnect' in state 'connecting'");
  }

  function scheduleSlackReconnect(error) {
    if (isSlackSocketStopping || slackReconnectTimer) {
      return;
    }

    if (error) {
      console.error('[slack:socket-mode] Scheduling reconnect in 30 seconds:', error.message || error);
    }

    slackReconnectTimer = setTimeout(() => {
      slackReconnectTimer = null;
      reconnectSlackSocket().catch((reconnectError) => {
        console.error('[slack:socket-mode] Reconnect failed:', reconnectError);
        scheduleSlackReconnect(reconnectError);
      });
    }, SLACK_RECONNECT_INTERVAL_MS);
  }

  async function reconnectSlackSocket() {
    isSlackSocketRestarting = true;
    try {
      const client = getSlackSocketModeClient(app);
      if (client) {
        try {
          await client.disconnect();
        } catch (error) {
          console.error('[slack:socket-mode] Error while cleaning up stale connection:', error.message || error);
        }
      }

      await startSlackBot();
    } finally {
      isSlackSocketRestarting = false;
    }
  }

  async function shutdown(signal) {
    isSlackSocketStopping = true;
    if (slackReconnectTimer) {
      clearTimeout(slackReconnectTimer);
      slackReconnectTimer = null;
    }

    try {
      await app.stop();
    } catch (error) {
      console.error(`[slack:socket-mode] Error during ${signal} shutdown:`, error);
    } finally {
      process.exit(0);
    }
  }

  return {
    shutdown,
    start: startSlackBot,
  };
}

function installShutdownHandlers(lifecycle) {
  process.on('SIGINT', () => {
    lifecycle.shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    lifecycle.shutdown('SIGTERM');
  });
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

  return {
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

function getSlackSocketModeClient(slackApp) {
  return slackApp.receiver && slackApp.receiver.client;
}

function resolveSlackLogLevel(value) {
  const normalized = String(value || 'INFO').toUpperCase();
  return LogLevel[normalized] || LogLevel.INFO;
}

module.exports = {
  createSlackApp,
  createSlackLifecycle,
  installShutdownHandlers,
  registerSlackHandlers,
};
