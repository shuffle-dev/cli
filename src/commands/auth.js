const open = require('open');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const crypto = require('crypto');
const express = require('express');
const getPort = require('get-port');
const fetch = require('node-fetch');
const os = require('os');
const config = require('../config');
const api = require('../api');

class AuthCommand {
    static async execute(options = {}) {
        console.log(chalk.blue('🔐 Shuffle CLI Authentication'));
        console.log();

        // Start callback server. Bind to all interfaces by default so the
        // browser can complete auth from another machine when needed.
        const callbackBindHost = options.bind || process.env.SHUFFLE_CALLBACK_BIND_HOST || '0.0.0.0';
        const callbackHost = AuthCommand.getCallbackHost(options.host);
        const callbackPort = await AuthCommand.getCallbackPort(options.port);
        const callbackUrl = `http://${callbackHost}:${callbackPort}/callback`;

        // Generate PKCE parameters
        const codeVerifier = AuthCommand.generateCodeVerifier();
        const codeChallenge = AuthCommand.generateCodeChallenge(codeVerifier);
        const state = crypto.randomBytes(32).toString('hex');

        // Start Express server for callback
        const app = express();
        let server;
        let authResult = null;

        const authPromise = new Promise((resolve) => {
            app.get('/callback', (req, res) => {
                const { code, state: returnedState, error } = req.query;

                if (error) {
                    res.send(`
            <html>
              <head><title>Authentication Failed</title></head>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
                    authResult = { error };
                    resolve();
                    return;
                }

                if (!code || returnedState !== state) {
                    res.send(`
            <html>
              <head><title>Authentication Failed</title></head>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
                <p>Invalid authorization code or state mismatch.</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
                    authResult = { error: 'Invalid authorization response' };
                    resolve();
                    return;
                }

                res.send(`
          <html>
            <head><title>Authentication Successful</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: rgb(55, 88, 249);">✅ Authentication Successful!</h1>
              <p>You have been successfully authenticated with Shuffle CLI.</p>
              <p>You can now close this window and return to your terminal.</p>
              <script>
                setTimeout(() => {
                  window.close();
                }, 3000);
              </script>
            </body>
          </html>
        `);

                authResult = { code, state: returnedState, codeVerifier };
                resolve();
            });

            server = app.listen(callbackPort, callbackBindHost, () => {
                console.log(chalk.gray(`\r\nCallback server listening on ${callbackBindHost}:${callbackPort}`));
                console.log(chalk.gray(`Callback URL: ${callbackUrl}`));
            });
            server.on('error', (error) => {
                authResult = { error: `Callback server failed to start: ${error.message}` };
                resolve();
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                if (!authResult) {
                    authResult = { error: 'Authentication timeout' };
                    resolve();
                }
            }, config.getAuthTimeout());
        });

        // Construct auth URL
        const authUrl = new URL(config.getAuthUrl());
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('redirect_uri', callbackUrl);

        if (options.open === false) {
            console.log(chalk.yellow('Open this URL in your browser to authenticate:'));
        } else {
            console.log(chalk.yellow('Opening browser for authentication...'));
        }
        console.log();
        if (options.open !== false) {
            console.log(chalk.gray('If the browser doesn\'t open automatically, copy and paste this URL:'));
        }
        console.log(chalk.cyan(authUrl.toString()));
        console.log();
        console.log(chalk.gray('Waiting for authentication... (This will timeout in 5 minutes)'));

        // Open browser
        if (options.open !== false) {
            try {
                await open(authUrl.toString());
            } catch (error) {
                console.log(chalk.yellow('Could not open the browser automatically. Open the URL above in your browser.'));
            }
        }

        // Wait for authentication callback
        const spinner = ora('Waiting for authentication...').start();
        await authPromise;
        spinner.stop();

        // Close server
        if (server) {
            server.close();
        }

        if (!authResult || authResult.error) {
            console.log(chalk.red('❌ Authentication failed:'), authResult?.error || 'Unknown error');
            process.exit(1);
        }

        // Exchange code for token
        const tokenSpinner = ora('Exchanging authorization code for access token...').start();

        try {
            // Use full token URL instead of relative path
            const tokenUrl = config.getTokenUrl();
            const formData = new URLSearchParams({
                code: authResult.code,
                code_verifier: authResult.codeVerifier,
                redirect_uri: callbackUrl
            });

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const tokenResponse = await response.json();

            if (tokenResponse.access_token) {
                config.setToken(tokenResponse.access_token);
                tokenSpinner.succeed(chalk.green('Authentication successful!'));

                // Verify authentication by getting user info
                try {
                    const userInfo = await api.get('/user');
                    console.log(chalk.green(`Welcome, ${userInfo.name || userInfo.email}!`));
                } catch (userError) {
                    console.log(chalk.green('Authentication successful!'));
                }

                // Exit successfully
                process.exit(0);
            } else {
                tokenSpinner.fail(chalk.red('Failed to obtain access token'));
                process.exit(1);
            }
        } catch (error) {
            tokenSpinner.fail(chalk.red('Authentication failed'));
            console.error(chalk.red('Error:', error.response?.data?.message || error.message));
            process.exit(1);
        }
    }

    static generateCodeVerifier() {
        return crypto.randomBytes(32).toString('base64url');
    }

    static generateCodeChallenge(verifier) {
        return crypto.createHash('sha256').update(verifier).digest('base64url');
    }

    static getCallbackHost(optionHost) {
        const host = optionHost || process.env.SHUFFLE_CALLBACK_HOST || AuthCommand.getFirstExternalIPv4() || 'localhost';
        return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    }

    static getCallbackPort(optionPort) {
        const configuredPort = optionPort || process.env.SHUFFLE_CALLBACK_PORT;

        if (configuredPort) {
            const parsedPort = Number.parseInt(configuredPort, 10);

            if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
                throw new Error(`Invalid callback port: ${configuredPort}`);
            }

            return parsedPort;
        }

        return getPort({ port: config.getCallbackPorts() });
    }

    static getFirstExternalIPv4() {
        const interfaces = os.networkInterfaces();

        for (const addresses of Object.values(interfaces)) {
            for (const address of addresses || []) {
                if (address.family === 'IPv4' && !address.internal) {
                    return address.address;
                }
            }
        }

        return null;
    }
}

module.exports = AuthCommand;
