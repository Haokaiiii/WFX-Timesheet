const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const open = require('open');
const config = require('./config');
const jwt = require('jsonwebtoken');

/**
 * WorkflowMax OAuth 2.0 Authentication Manager
 * Implements OAuth 2.0 flow according to WorkflowMax documentation
 * https://support.workflowmax.com/hc/en-us/articles/28754786654233-API-authentication
 */
class WorkflowMaxAuthManager {
  constructor() {
    this.tokenPath = process.env.TOKEN_STORAGE_PATH || path.join(config.directories.data, 'wfx_tokens.json');
    this.state = null;
    this.sessionData = null;
  }

  /**
   * Generate secure state parameter for CSRF protection
   */
  generateState() {
    this.state = crypto.randomBytes(32).toString('hex');
    return this.state;
  }

  /**
   * Build authorization URL according to WorkflowMax specifications
   */
  buildAuthorizationUrl(redirectUri = null) {
    const state = this.generateState();
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.wfx.clientId,
      redirect_uri: redirectUri || config.wfx.callbackUrl,
      scope: config.wfx.scopes,
      state: state,
      prompt: 'consent' // Recommended for security
    });

    const authUrl = `${config.wfx.authUrl}?${params.toString()}`;
    
    if (config.debug.auth) {
      console.log(chalk.gray('🔗 Authorization URL built:'));
      console.log(chalk.gray(`   Base: ${config.wfx.authUrl}`));
      console.log(chalk.gray(`   Client ID: ${config.wfx.clientId}`));
      console.log(chalk.gray(`   Redirect: ${redirectUri || config.wfx.callbackUrl}`));
      console.log(chalk.gray(`   Scopes: ${config.wfx.scopes}`));
      console.log(chalk.gray(`   State: ${state.substring(0, 20)}...`));
    }

    return authUrl;
  }

  /**
   * Save session data for callback processing
   */
  async saveSessionData() {
    const sessionPath = path.join(config.directories.data, 'auth_session.json');
    const sessionData = {
      state: this.state,
      timestamp: Date.now(),
      callbackUrl: config.wfx.callbackUrl
    };

    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2));
    
    if (config.debug.auth) {
      console.log(chalk.gray('💾 Session data saved'));
    }
  }

  /**
   * Load session data for callback processing
   */
  async loadSessionData() {
    const sessionPath = path.join(config.directories.data, 'auth_session.json');
    try {
      const data = await fs.readFile(sessionPath, 'utf8');
      this.sessionData = JSON.parse(data);
      
      // Check if session is expired (older than 10 minutes)
      if (Date.now() - this.sessionData.timestamp > 10 * 60 * 1000) {
        throw new Error('Session expired');
      }
      
      return this.sessionData;
    } catch (error) {
      throw new Error('No valid session data found. Please start authentication again.');
    }
  }

  /**
   * Clear session data
   */
  async clearSessionData() {
    const sessionPath = path.join(config.directories.data, 'auth_session.json');
    try {
      await fs.unlink(sessionPath);
    } catch {
      // File might not exist
    }
  }

  /**
   * Exchange authorization code for tokens according to WorkflowMax specs
   */
  async exchangeCodeForTokens(code, state, redirectUri = null) {
    // Load and validate session data
    const session = await this.loadSessionData();
    
    // Validate state to prevent CSRF attacks
    if (state !== session.state) {
      throw new Error('Invalid state parameter - possible CSRF attack');
    }

    // Prepare token exchange request - parameters in body as per WorkflowMax docs
    const requestBody = {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri || session.callbackUrl,
      client_id: config.wfx.clientId,
      client_secret: config.wfx.clientSecret
    };

    if (config.debug.auth) {
      console.log(chalk.gray('🔄 Exchanging code for tokens:'));
      console.log(chalk.gray(`   Token URL: ${config.wfx.tokenUrl}`));
      console.log(chalk.gray(`   Code: ${code.substring(0, 20)}...`));
      console.log(chalk.gray(`   Redirect URI: ${redirectUri || session.callbackUrl}`));
    }

    try {
      const response = await axios.post(config.wfx.tokenUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 30000
      });

      // Save tokens
      await this.saveTokens(response.data);
      
      // Clear session data
      await this.clearSessionData();

      console.log(chalk.green('✅ Authentication successful!'));
      
      // Decode JWT to get organization ID
      try {
        const decoded = jwt.decode(response.data.access_token);
        if (decoded && decoded.org) {
          console.log(chalk.gray(`   Organization ID: ${decoded.org}`));
        }
      } catch {
        // JWT decode failed, not critical
      }
      
      return response.data;
    } catch (error) {
      if (error.response) {
        const errorData = error.response.data;
        console.error(chalk.red('❌ Token exchange failed:'));
        console.error(chalk.red(`   Status: ${error.response.status}`));
        console.error(chalk.red(`   Error: ${errorData.error || 'Unknown error'}`));
        console.error(chalk.red(`   Description: ${errorData.error_description || 'No description'}`));
        
        if (config.debug.auth) {
          console.error(chalk.gray('Full error response:'), errorData);
        }
        
        if (errorData.error === 'access_denied') {
          throw new Error('Access denied by user or authorization server');
        } else if (errorData.error === 'invalid_grant') {
          throw new Error('Authorization code is invalid or expired. Please try again.');
        } else if (errorData.error === 'invalid_client') {
          throw new Error('Client authentication failed. Check your client ID and secret.');
        }
      }
      throw error;
    }
  }

  /**
   * Save tokens securely with expiry calculations
   */
  async saveTokens(tokenData) {
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      saved_at: Date.now(),
      expires_at: Date.now() + (tokenData.expires_in * 1000) // 30 minutes for access token
    };

    // Extract organization ID from JWT if possible
    try {
      const decoded = jwt.decode(tokenData.access_token);
      if (decoded && decoded.org) {
        tokens.organization_id = decoded.org;
      }
    } catch {
      // JWT decode failed, not critical
    }

    await fs.mkdir(path.dirname(this.tokenPath), { recursive: true });
    await fs.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));
    
    if (config.debug.auth) {
      console.log(chalk.gray('💾 Tokens saved successfully'));
      console.log(chalk.gray(`   Access token expires in: ${tokenData.expires_in} seconds`));
      if (tokenData.refresh_token) {
        console.log(chalk.gray('   Refresh token saved (expires in 60 days)'));
      }
    }
  }

  /**
   * Load saved tokens
   */
  async loadTokens() {
    try {
      const data = await fs.readFile(this.tokenPath, 'utf8');
      const tokens = JSON.parse(data);
      
      // Check if access token is expired (30 minutes)
      if (tokens.expires_at && Date.now() > tokens.expires_at) {
        console.log(chalk.yellow('⚠️  Access token expired'));
        // Could implement refresh token logic here
        return null;
      }
      
      return tokens;
    } catch (error) {
      return null;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    const tokens = await this.loadTokens();
    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    const requestBody = {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: config.wfx.clientId,
      client_secret: config.wfx.clientSecret,
      scope: config.wfx.scopes
    };

    if (config.debug.auth) {
      console.log(chalk.gray('🔄 Refreshing access token...'));
    }

    try {
      const response = await axios.post(config.wfx.tokenUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      await this.saveTokens(response.data);
      console.log(chalk.green('✅ Token refreshed successfully'));
      
      return response.data;
    } catch (error) {
      console.error(chalk.red('❌ Token refresh failed:'), error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Check authentication status
   */
  async checkAuthStatus() {
    const tokens = await this.loadTokens();
    if (!tokens) {
      return { authenticated: false, reason: 'No tokens found' };
    }

    // Test API connection with WorkflowMax headers
    try {
      const response = await axios.get(`${config.wfx.baseUrl}/staff/current`, {
        headers: {
          'authorization': `Bearer ${tokens.access_token}`,
          'account_id': tokens.organization_id || config.wfx.accountId,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      return {
        authenticated: true,
        user: response.data,
        expiresAt: new Date(tokens.expires_at),
        organizationId: tokens.organization_id
      };
    } catch (error) {
      if (error.response?.status === 401) {
        // Try to refresh token
        if (tokens.refresh_token) {
          try {
            await this.refreshAccessToken();
            return await this.checkAuthStatus(); // Retry with new token
          } catch {
            return { authenticated: false, reason: 'Token refresh failed' };
          }
        }
        return { authenticated: false, reason: 'Token invalid or expired' };
      }
      return { authenticated: false, reason: error.message };
    }
  }

  /**
   * Clear all authentication data
   */
  async clearAuth() {
    try {
      await fs.unlink(this.tokenPath);
      await this.clearSessionData();
      console.log(chalk.yellow('🗑️  Authentication data cleared'));
    } catch {
      // Files might not exist
    }
  }

  /**
   * Start OAuth flow with browser
   */
  async startBrowserFlow() {
    const authUrl = this.buildAuthorizationUrl();
    await this.saveSessionData();
    
    console.log(chalk.bold.blue('\n🔐 Starting WorkflowMax OAuth Authentication\n'));
    console.log(chalk.yellow('Opening browser for authentication...'));
    console.log(chalk.gray('If browser doesn\'t open, visit this URL:'));
    console.log(chalk.cyan(authUrl));
    
    try {
      await open(authUrl);
    } catch {
      console.log(chalk.gray('\nCould not open browser automatically.'));
    }
    
    return authUrl;
  }

  /**
   * Start local server for callback handling
   */
  async startCallbackServer(port = 3001) {
    const app = express();
    
    // Parse JSON and URL-encoded bodies
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // OAuth callback endpoint
    app.get('/oauth/callback', async (req, res) => {
      const { code, state, error, error_description } = req.query;

      if (error) {
        console.error(chalk.red(`❌ OAuth error: ${error}`));
        console.error(chalk.red(`   Description: ${error_description || 'None'}`));
        
        res.status(400).send(`
          <html>
            <head>
              <title>Authentication Failed</title>
              <style>
                body { 
                  font-family: -apple-system, sans-serif; 
                  margin: 40px; 
                  background: #f5f5f5;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 80vh;
                }
                .container {
                  background: white;
                  padding: 40px;
                  border-radius: 8px;
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                  max-width: 500px;
                }
                .error { color: #dc3545; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1 class="error">Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>${error_description || ''}</p>
                <p>Please close this window and try again.</p>
              </div>
            </body>
          </html>
        `);
        return;
      }

      try {
        // Exchange code for tokens
        await this.exchangeCodeForTokens(code, state);
        
        res.send(`
          <html>
            <head>
              <title>Authentication Successful</title>
              <style>
                body { 
                  font-family: -apple-system, sans-serif; 
                  margin: 40px; 
                  background: #f5f5f5;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 80vh;
                }
                .container {
                  background: white;
                  padding: 40px;
                  border-radius: 8px;
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                  max-width: 500px;
                }
                .success { color: #28a745; }
              </style>
              <script>
                setTimeout(() => {
                  window.close();
                }, 3000);
              </script>
            </head>
            <body>
              <div class="container">
                <h1 class="success">✅ Authentication Successful!</h1>
                <p>You can close this window and return to the application.</p>
                <p><small>This window will close automatically in 3 seconds...</small></p>
              </div>
            </body>
          </html>
        `);
        
        // Shut down the server after successful authentication
        setTimeout(() => {
          process.exit(0);
        }, 3000);
      } catch (error) {
        console.error(chalk.red('❌ Token exchange failed:'), error.message);
        
        res.status(500).send(`
          <html>
            <head>
              <title>Authentication Error</title>
              <style>
                body { 
                  font-family: -apple-system, sans-serif; 
                  margin: 40px; 
                  background: #f5f5f5;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 80vh;
                }
                .container {
                  background: white;
                  padding: 40px;
                  border-radius: 8px;
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                  max-width: 600px;
                }
                .error { color: #dc3545; }
                pre { 
                  background: #f5f5f5; 
                  padding: 15px; 
                  overflow: auto; 
                  border-radius: 4px;
                  font-size: 12px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1 class="error">Authentication Error</h1>
                <p>${error.message}</p>
                <details>
                  <summary>Technical Details</summary>
                  <pre>${error.stack}</pre>
                </details>
                <p>Please close this window and check the console for details.</p>
              </div>
            </body>
          </html>
        `);
      }
    });

    // Status endpoint
    app.get('/api/auth/status', async (req, res) => {
      const status = await this.checkAuthStatus();
      res.json(status);
    });

    // Start server
    return new Promise((resolve) => {
      const server = app.listen(port, () => {
        console.log(chalk.green(`\n🚀 Auth callback server running on port ${port}`));
        console.log(chalk.gray('Waiting for OAuth callback...'));
        resolve(server);
      });
    });
  }
}

// Export for use in other modules
module.exports = WorkflowMaxAuthManager;

// CLI interface
if (require.main === module) {
  const authManager = new WorkflowMaxAuthManager();
  const command = process.argv[2];

  async function main() {
    try {
      switch (command) {
        case 'status':
          const status = await authManager.checkAuthStatus();
          if (status.authenticated) {
            console.log(chalk.green('✅ Authenticated'));
            console.log(chalk.gray(`   User: ${JSON.stringify(status.user)}`));
            console.log(chalk.gray(`   Organization ID: ${status.organizationId}`));
            console.log(chalk.gray(`   Expires: ${status.expiresAt}`));
          } else {
            console.log(chalk.red('❌ Not authenticated'));
            console.log(chalk.gray(`   Reason: ${status.reason}`));
          }
          break;

        case 'clear':
          await authManager.clearAuth();
          break;

        case 'refresh':
          await authManager.refreshAccessToken();
          console.log(chalk.green('✅ Token refreshed'));
          break;

        case 'auth':
        default:
          // Check current status
          const currentStatus = await authManager.checkAuthStatus();
          if (currentStatus.authenticated) {
            console.log(chalk.green('✅ Already authenticated!'));
            console.log(chalk.gray(`   Organization ID: ${currentStatus.organizationId}`));
            return;
          }

          // Start auth flow
          await authManager.startBrowserFlow();
          
          // Start callback server
          await authManager.startCallbackServer(config.server.port);
          
          // Keep server running
          console.log(chalk.gray('\nWaiting for authentication callback...'));
          console.log(chalk.gray('Press Ctrl+C to cancel'));
          break;
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  }

  main();
} 