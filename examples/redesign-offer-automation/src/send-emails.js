require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const { Resend } = require('resend');
const { readProspects, writeProspects } = require('./prospects');
const { parseShuffleOutput } = require('./shuffle-output');

const prospectsPath = path.join(process.cwd(), 'prospects.json');
const templatePath = path.join(process.cwd(), 'email-template.html');

(async () => {
  const apiKey = requireEnv('RESEND_API_KEY');
  const from = requireEnv('EMAIL_FROM');
  const subject = requireEnv('EMAIL_SUBJECT');
  const resend = new Resend(apiKey);
  const prospects = await readProspects(prospectsPath);
  const template = await fs.readFile(templatePath, 'utf8');

  for (const prospect of prospects) {
    if (prospect.email_sent) {
      console.log(`[skip] ${prospect.email} already sent: ${prospect.email_sent}`);
      continue;
    }

    if (!prospect.redesign) {
      console.log(`[skip] ${prospect.email} has no redesign file yet`);
      continue;
    }

    const redesignPath = path.resolve(process.cwd(), prospect.redesign);
    const redesignContent = await fs.readFile(redesignPath, 'utf8');
    const email = buildEmail({ prospect, redesignContent, subject, template });

    console.log(`[email] sending redesign offer to ${prospect.email}`);
    const response = await resend.emails.send({
      from,
      to: prospect.email,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    if (response.error) {
      throw new Error(`Resend failed for ${prospect.email}: ${response.error.message}`);
    }

    prospect.email_sent = formatSentAt(new Date());
    await writeProspects(prospectsPath, prospects);
    console.log(`[email] sent to ${prospect.email}: ${prospect.email_sent}`);
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

function buildEmail({ prospect, redesignContent, subject, template }) {
  const models = parseShuffleOutput(redesignContent).models;
  const params = {
    subject: escapeHtml(subject),
    email: escapeHtml(prospect.email),
    websiteUrl: escapeHtml(prospect.url),
    modelsHtml: renderModels(models),
  };

  const html = renderTemplate(template, params);
  const text = htmlToText(html);

  return { subject, text, html };
}

function renderTemplate(template, params) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
    if (!(key in params)) {
      return match;
    }

    return params[key];
  });
}

function renderModels(models) {
  if (models.length === 0) {
    return '<p style="margin:0; font-size:15px; line-height:1.6; color:#66727f;">No generated model previews were found in the redesign output.</p>';
  }

  return models.map((model, index) => renderModel(model, index)).join('');
}

function renderModel(model, index) {
  const name = `Concept #${index + 1}`;
  const previewUrl = model.previewUrl || model.editUrl || '';
  const screenshot = model.screenshotUrl
    ? `<img src="${escapeAttribute(model.screenshotUrl)}" alt="${escapeAttribute(name)} screenshot" width="714" style="display:block; width:100%; max-width:714px; height:auto; border:1px solid #d9e0e6; border-radius:8px;">`
    : '<p style="margin:0; font-size:14px; line-height:1.6; color:#66727f;">No screenshot URL was found for this option.</p>';

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px; border:1px solid #d9e0e6; border-radius:10px; border-collapse:separate; overflow:hidden; background:#ffffff;">
  <tr>
    <td style="padding:14px 16px; border-bottom:1px solid #e8edf2; background:#fbfcfd;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="font-size:16px; line-height:1.4; font-weight:700; color:#17202a;">${escapeHtml(name)}</td>
          <td align="right" style="font-size:14px; line-height:1.4;">${previewUrl ? `<a href="${escapeAttribute(previewUrl)}" style="display:inline-block; padding:9px 12px; border-radius:6px; background:#17202a; color:#ffffff; text-decoration:none; font-weight:700;">Open preview</a>` : ''}</td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:14px;">${previewUrl ? `<a href="${escapeAttribute(previewUrl)}" style="text-decoration:none;">${screenshot}</a>` : screenshot}</td>
  </tr>
</table>`;
}

function htmlToText(html) {
  return decodeHtmlEntities(String(html || '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<([a-z0-9]+)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, '\n$1\n')
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match, href, label) => {
      const text = stripTags(label).trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<\/(h1|h2|h3|p|div|tr|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#96;/g, '`');
}

function formatSentAt(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env before running npm run send-emails.`);
  }

  return value;
}
