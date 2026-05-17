const fs = require('fs/promises');

const FIELDS = ['email', 'url', 'redesign', 'email_sent'];

async function readProspects(prospectsPath) {
  const contents = await fs.readFile(prospectsPath, 'utf8');
  const parsed = JSON.parse(contents);

  if (!Array.isArray(parsed)) {
    throw new Error('prospects.json must contain an array of prospects.');
  }

  return parsed.map((prospect, index) => normalizeProspect(prospect, index));
}

async function writeProspects(prospectsPath, prospects) {
  const normalized = prospects.map((prospect, index) => {
    const record = normalizeProspect(prospect, index);
    const output = {};

    for (const field of FIELDS) {
      output[field] = record[field];
    }

    return output;
  });

  await fs.writeFile(prospectsPath, `${JSON.stringify(normalized, null, 2)}\n`);
}

function normalizeProspect(prospect, index) {
  if (!prospect || typeof prospect !== 'object' || Array.isArray(prospect)) {
    throw new Error(`Prospect at index ${index} must be an object.`);
  }

  const normalized = { _index: index };

  for (const field of FIELDS) {
    normalized[field] = stringifyField(prospect[field]);
  }

  if (!normalized.email) {
    throw new Error(`Prospect at index ${index} is missing email.`);
  }

  if (!normalized.url) {
    throw new Error(`Prospect at index ${index} is missing url.`);
  }

  return normalized;
}

function stringifyField(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

module.exports = {
  readProspects,
  writeProspects,
};
