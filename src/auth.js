const express = require('express');
const chalk = require('chalk');
const WFXApiClient = require('./wfxApi');
const config = require('./config');
const open = require('open');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const axios = require('axios');

/**
 * Unified authentication handler for WorkflowMax
 * Automatically detects the best method based on configuration
 */
class AuthManager {
  constructor() {
    this.wfxClient = new WFXApiClient();
  }

  /**
   * Main authentication method - automatically chooses the best approach
   */
  async authenticate() {
    console.log(chalk.bold.blue('\n🔐 WorkflowMax Authentication\n'));

    // Check current auth status
    if (await this.checkAuthStatus()) {
      console.log(chalk.green('✅ Already authenticated and connected!'));
      return true;
    }

    // Determine best auth method based on callback URL
    const callbackUrl = config.wfx.callbackUrl;
    
    if (callbackUrl.includes('ngrok') || callbackUrl.includes('https://')) {
      // Use dashboard method for external URLs
      return await this.authenticateViaDashboard();
    } else if (callbackUrl.includes('localhost:8080')) {
      // Use local server method
      return await this.authenticateViaLocalServer();
    } else {
      // Fallback to manual method
      console.log(chalk.yellow('⚠️  Unusual callback URL detected, using manual authentication'));
      return await this.authenticateManually();
    }
  }

  /**
   * Check if already authenticated
   */
  async checkAuthStatus() {
    try {
      await this.wfxClient.loadSavedTokens();
      if (this.wfxClient.isAuthenticated()) {
        // Test the connection
        const staff = await this.wfxClient.getStaff();
        console.log(chalk.gray(`Connected to WorkflowMax (${staff.length} staff members)`));
        return true;
      }
    } catch (error) {
      // Tokens invalid or API error
      return false;
    }
    return false;
  }

  /**
   * Authenticate using dashboard callback
   */
  async authenticateViaDashboard() {
    console.log(chalk.yellow('Using dashboard authentication (ngrok/external URL)'));
    console.log(chalk.gray(`Callback URL: ${config.wfx.callbackUrl}\n`));

    // Check if dashboard is running
    try {
      const dashboardUrl = `http://localhost:${config.server.port || 3000}`;
      await axios.get(`${dashboardUrl}/api/auth/status`).catch(() => {});
    } catch {
      console.log(chalk.yellow('⚠️  Dashboard not running. Please start it with: npm start'));
      return false;
    }

    const authUrl = this.wfxClient.getAuthorizationUrl();
    
    console.log(chalk.yellow('Opening browser for authentication...'));
    console.log(chalk.gray('After logging in, check your dashboard for success.\n'));
    console.log(chalk.cyan(authUrl));

    try {
      await open(authUrl);
    } catch {
      console.log(chalk.gray('\nCould not open browser automatically.'));
    }

    // Wait for user confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await new Promise(resolve => {
      rl.question(chalk.yellow('\nPress Enter after completing authentication in the browser...'), () => {
        rl.close();
        resolve();
      });
    });

    // Check if authentication was successful
    return await this.checkAuthStatus();
  }

  /**
   * Authenticate using local server
   */
  async authenticateViaLocalServer() {
    console.log(chalk.yellow('Using local server authentication'));
    
    const app = express();
    const port = 8080;
    
    return new Promise((resolve, reject) => {
      let server;
      
      app.get('/oauth/callback', async (req, res) => {
        const { code, error } = req.query;
        
        if (error) {
          res.send(this.getErrorHTML(error));
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        
        try {
          await this.wfxClient.exchangeCodeForToken(code, `http://localhost:${port}/oauth/callback`);
          res.send(this.getSuccessHTML());
          
          // Test connection
          const staff = await this.wfxClient.getStaff();
          console.log(chalk.green(`\n✅ Authenticated! Connected to ${staff.length} staff members`));
          
          server.close();
          resolve(true);
        } catch (error) {
          res.send(this.getErrorHTML(error.message));
          server.close();
          reject(error);
        }
      });
      
      server = app.listen(port, async () => {
        const authUrl = this.wfxClient.getAuthorizationUrl(`http://localhost:${port}/oauth/callback`);
        
        console.log(chalk.gray(`Local auth server running on port ${port}`));
        console.log(chalk.yellow('\nOpening browser for authentication...'));
        console.log(chalk.cyan(authUrl));
        
        try {
          await open(authUrl);
        } catch {
          console.log(chalk.gray('\nCould not open browser automatically.'));
        }
      });
      
      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timeout'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Manual authentication fallback
   */
  async authenticateManually() {
    console.log(chalk.yellow('Using manual authentication'));
    
    const authUrl = this.wfxClient.getAuthorizationUrl();
    
    console.log(chalk.gray('\n1. Visit this URL:'));
    console.log(chalk.cyan(authUrl));
    console.log(chalk.gray('\n2. Log in and authorize the app'));
    console.log(chalk.gray('3. Copy the authorization code from the callback URL'));
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const code = await new Promise(resolve => {
      rl.question(chalk.yellow('\nEnter authorization code: '), (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
    
    try {
      await this.wfxClient.exchangeCodeForToken(code);
      
      // Test connection
      const staff = await this.wfxClient.getStaff();
      console.log(chalk.green(`\n✅ Authenticated! Connected to ${staff.length} staff members`));
      
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Authentication failed:'), error.message);
      return false;
    }
  }

  /**
   * Clear saved tokens
   */
  async clearTokens() {
    try {
      const tokenPath = path.join(config.directories.data, 'wfx_tokens.json');
      await fs.unlink(tokenPath);
      console.log(chalk.yellow('🗑️  Cleared saved authentication tokens'));
    } catch {
      // Tokens might not exist
    }
  }

  // HTML templates for local server responses
  getSuccessHTML() {
    return `
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f7; }
            .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #28a745; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Authentication Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </div>
        </body>
      </html>
    `;
  }

  getErrorHTML(error) {
    return `
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f7; }
            .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #dc3545; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Authentication Failed</h1>
            <p>Error: ${error}</p>
            <p>Please close this window and try again.</p>
          </div>
        </body>
      </html>
    `;
  }
}

// CLI interface
if (require.main === module) {
  const authManager = new AuthManager();
  
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'clear') {
    authManager.clearTokens().then(() => process.exit(0));
  } else if (command === 'status') {
    authManager.checkAuthStatus().then(isAuth => {
      console.log(isAuth ? chalk.green('✅ Authenticated') : chalk.red('❌ Not authenticated'));
      process.exit(isAuth ? 0 : 1);
    });
  } else {
    authManager.authenticate()
      .then(success => process.exit(success ? 0 : 1))
      .catch(error => {
        console.error(chalk.red('Authentication error:'), error.message);
        process.exit(1);
      });
  }
}

module.exports = AuthManager; 