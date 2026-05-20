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

function cleanPrompt(text) {
  return String(text || '')
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  cleanPrompt,
  parseDesignRequest,
};
