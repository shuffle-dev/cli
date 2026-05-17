require('dotenv').config();

const path = require('path');
const { readProspects, writeProspects } = require('./prospects');
const { createRedesign } = require('./shuffle');

const prospectsPath = path.join(process.cwd(), 'prospects.json');

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const prospects = await readProspects(prospectsPath);

  for (const prospect of prospects) {
    if (prospect.redesign) {
      console.log(`[skip] ${prospect.email} already has redesign: ${prospect.redesign}`);
      continue;
    }

    console.log(`[redesign] creating redesign for ${prospect.email} (${prospect.url})`);
    const outputFile = await createRedesign(prospect, { prompt: options.prompt });
    prospect.redesign = path.relative(process.cwd(), outputFile);
    await writeProspects(prospectsPath, prospects);
    console.log(`[redesign] saved ${prospect.redesign}`);
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

function parseArgs(args) {
  const options = { prompt: '' };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--prompt') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --prompt.');
      }

      options.prompt = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--prompt=')) {
      options.prompt = arg.slice('--prompt='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}
