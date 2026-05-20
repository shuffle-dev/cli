require('dotenv').config();

const {
  createSlackApp,
  createSlackLifecycle,
  installShutdownHandlers,
  registerSlackHandlers,
} = require('./slack');
const { createShuffleDesign } = require('./shuffle');

const requiredEnv = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const app = createSlackApp();
registerSlackHandlers(app, { createShuffleDesign });

const lifecycle = createSlackLifecycle(app);
installShutdownHandlers(lifecycle);
lifecycle.start();
