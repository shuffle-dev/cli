require('dotenv').config();

const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { readProspects, writeProspects } = require('./prospects');
const { parseShuffleOutput } = require('./shuffle-output');

const prospectsPath = path.join(process.cwd(), 'prospects.json');
const port = Number.parseInt(process.env.PREVIEW_PORT || '3333', 10);
const host = process.env.PREVIEW_HOST || '127.0.0.1';

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);

    if (request.method === 'GET' && url.pathname === '/') {
      await renderPreview(response, url);
      return;
    }

    if (request.method === 'POST') {
      await handlePost(url.pathname);
      redirect(response, normalizeStatus(url.searchParams.get('status')));
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(error.stack || error.message);
  }
});

server.listen(port, host, () => {
  console.log(`Preview running at http://${host}:${port}`);
});

async function renderPreview(response, url) {
  const status = normalizeStatus(url.searchParams.get('status'));
  const prospects = await loadPreviewProspects(status);

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(buildHtml(prospects, status));
}

async function loadPreviewProspects(status) {
  const prospects = await readProspects(prospectsPath);
  const visible = [];

  for (let index = 0; index < prospects.length; index += 1) {
    const prospect = prospects[index];
    if (!prospect.redesign) {
      continue;
    }

    if (status === 'sent' && !prospect.email_sent) {
      continue;
    }

    if (status === 'not-sent' && prospect.email_sent) {
      continue;
    }

    const outputPath = path.resolve(process.cwd(), prospect.redesign);
    let output = '';
    let readError = null;

    try {
      output = await fs.readFile(outputPath, 'utf8');
    } catch (error) {
      readError = error.message;
    }

    visible.push({
      index,
      prospect,
      status,
      outputPath,
      readError,
      models: readError ? [] : parseShuffleOutput(output).models.slice(0, 4),
    });
  }

  return visible;
}

async function handlePost(url) {
  const prospectDelete = url.match(/^\/prospects\/(\d+)\/delete$/);
  if (prospectDelete) {
    const prospectIndex = Number.parseInt(prospectDelete[1], 10);
    const prospects = await readProspects(prospectsPath);

    if (!prospects[prospectIndex]) {
      throw new Error('Prospect not found.');
    }

    prospects[prospectIndex].redesign = '';
    await writeProspects(prospectsPath, prospects);
    return;
  }

  const modelDelete = url.match(/^\/prospects\/(\d+)\/models\/(\d+)\/delete$/);
  if (modelDelete) {
    const prospectIndex = Number.parseInt(modelDelete[1], 10);
    const modelIndex = Number.parseInt(modelDelete[2], 10);
    const prospects = await readProspects(prospectsPath);
    const prospect = prospects[prospectIndex];

    if (!prospect || !prospect.redesign) {
      throw new Error('Prospect output not found.');
    }

    const outputPath = path.resolve(process.cwd(), prospect.redesign);
    await deleteModelFromOutput(outputPath, modelIndex);
    return;
  }

  throw new Error('Unsupported action.');
}

async function deleteModelFromOutput(outputPath, modelIndex) {
  const output = await fs.readFile(outputPath, 'utf8');
  const parsed = parseShuffleOutput(output);

  if (!parsed.models[modelIndex]) {
    throw new Error('Model response not found.');
  }

  parsed.models.splice(modelIndex, 1);

  const parts = [];
  const header = parsed.headerLines.join('\n').trimEnd();
  if (header) {
    parts.push(header);
  }

  for (const model of parsed.models) {
    parts.push(model.lines.join('\n').trimEnd());
  }

  await fs.writeFile(outputPath, `${parts.join('\n')}\n`);
}

function buildHtml(prospects, status) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redesign Offers Preview</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f2933;
      background: #f5f7f8;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
    }

    main {
      width: min(1500px, calc(100% - 32px));
      margin: 0 auto;
      padding: 24px 0 48px;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
    }

    .count {
      color: #52616b;
      font-size: 14px;
    }

    .tabs {
      display: flex;
      gap: 8px;
      margin: 0 0 18px;
      border-bottom: 1px solid #d8dee4;
    }

    .tab {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 12px;
      border: 1px solid transparent;
      border-bottom: 0;
      border-radius: 7px 7px 0 0;
      color: #52616b;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
    }

    .tab:hover {
      color: #24292f;
      background: #ffffff;
    }

    .tab.active {
      color: #24292f;
      background: #ffffff;
      border-color: #d8dee4;
      margin-bottom: -1px;
    }

    .empty {
      padding: 32px;
      border: 1px solid #d8dee4;
      background: #ffffff;
      border-radius: 8px;
      color: #52616b;
    }

    .prospect {
      border: 1px solid #d8dee4;
      background: #ffffff;
      border-radius: 8px;
      margin-bottom: 18px;
      overflow: hidden;
    }

    .prospect-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      border-bottom: 1px solid #e6ebef;
      background: #fbfcfd;
    }

    .identity {
      min-width: 0;
    }

    .email {
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .url {
      margin-top: 3px;
      color: #52616b;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .models {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      background: #e6ebef;
    }

    .model {
      min-width: 0;
      background: #ffffff;
    }

    .model-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 52px;
      padding: 10px 12px;
      border-bottom: 1px solid #edf1f4;
    }

    .model-name {
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .screenshot {
      width: 100%;
      display: block;
      object-fit: cover;
      object-position: top center;
      background: #ffffff;
    }

    .fallback {
      min-height: 220px;
      padding: 16px;
      color: #52616b;
      font-size: 13px;
      line-height: 1.5;
    }

    .fallback a {
      color: #1f6feb;
      overflow-wrap: anywhere;
    }

    button,
    .button {
      border: 1px solid #c9d2da;
      background: #ffffff;
      color: #24292f;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      text-decoration: none;
      line-height: 1;
    }

    button:hover,
    .button:hover {
      background: #f3f5f7;
    }

    .delete button {
      border-color: #f0b8b8;
      color: #9f1d1d;
    }

    @media (max-width: 1180px) {
      .models {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 700px) {
      main {
        width: min(100% - 20px, 1500px);
      }

      header,
      .prospect-bar {
        align-items: flex-start;
        flex-direction: column;
      }

      .models {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Redesign Offers Preview</h1>
      <div class="count">${prospects.length} ${status === 'sent' ? 'sent' : 'not sent'} prospect${prospects.length === 1 ? '' : 's'} with generated redesigns</div>
    </header>
    <nav class="tabs" aria-label="Email status">
      <a class="tab ${status === 'not-sent' ? 'active' : ''}" href="/">not sent</a>
      <a class="tab ${status === 'sent' ? 'active' : ''}" href="/?status=sent">sent</a>
    </nav>
    ${prospects.length === 0 ? '<section class="empty">No prospects have a redesign output path yet.</section>' : prospects.map(renderProspect).join('')}
  </main>
</body>
</html>`;
}

function renderProspect(item) {
  const { prospect } = item;
  const query = item.status === 'sent' ? '?status=sent' : '';
  return `<section class="prospect">
  <div class="prospect-bar">
    <div class="identity">
      <div class="email">${escapeHtml(prospect.email)}</div>
      <div class="url">${escapeHtml(prospect.url)}</div>
    </div>
    <form class="delete" method="post" action="/prospects/${item.index}/delete${query}" onsubmit="return confirm('Clear this prospect’s redesigns? This only removes the redesigns that were created, not the prospect entry itself.');">
      <button type="submit">DELETE</button>
    </form>
  </div>
  ${item.readError ? renderError(item.readError) : renderModels(item)}
</section>`;
}

function renderModels(item) {
  if (item.models.length === 0) {
    return '<div class="fallback">No model responses were found in this output file.</div>';
  }

  return `<div class="models">${item.models.map((model, index) => renderModel(item.index, index, model, item.status)).join('')}</div>`;
}

function renderModel(prospectIndex, modelIndex, model, status) {
  const query = status === 'sent' ? '?status=sent' : '';
  return `<article class="model">
  <div class="model-bar">
    <div class="model-name">${escapeHtml(model.name)}</div>
    <div class="actions">
      ${model.previewUrl ? `<a class="button" href="${escapeAttribute(model.previewUrl)}" target="_blank" rel="noreferrer">Preview</a>` : ''}
      <form class="delete" method="post" action="/prospects/${prospectIndex}/models/${modelIndex}/delete${query}" onsubmit="return confirm('Delete this model response from the output file?');">
        <button type="submit">DELETE</button>
      </form>
    </div>
  </div>
  ${model.screenshotUrl ? `<img class="screenshot" src="${escapeAttribute(model.screenshotUrl)}" alt="${escapeAttribute(model.name)} screenshot">` : renderModelFallback(model)}
</article>`;
}

function renderModelFallback(model) {
  const links = [
    model.editUrl ? `<a href="${escapeAttribute(model.editUrl)}" target="_blank" rel="noreferrer">Edit</a>` : '',
    model.previewUrl ? `<a href="${escapeAttribute(model.previewUrl)}" target="_blank" rel="noreferrer">Preview</a>` : '',
    model.screenshotUrl ? `<a href="${escapeAttribute(model.screenshotUrl)}" target="_blank" rel="noreferrer">Screenshot</a>` : '',
  ].filter(Boolean);

  return `<div class="fallback">${links.length > 0 ? links.join(' · ') : 'No preview URL found for this model.'}</div>`;
}

function renderError(message) {
  return `<div class="fallback">Could not read output file: ${escapeHtml(message)}</div>`;
}

function redirect(response, status) {
  response.writeHead(303, { location: status === 'sent' ? '/?status=sent' : '/' });
  response.end();
}

function normalizeStatus(value) {
  return value === 'sent' ? 'sent' : 'not-sent';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
