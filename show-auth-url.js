const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const config = require('./src/config');

async function showAuthUrl() {
  console.log(chalk.bold.blue('\n🔗 WorkflowMax Authorization URL\n'));
  
  try {
    // Load session data
    const sessionPath = path.join(config.directories.data, 'auth_session.json');
    const sessionData = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    
    // Build the authorization URL with the saved state
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.wfx.clientId,
      redirect_uri: sessionData.callbackUrl,
      scope: config.wfx.scopes,
      state: sessionData.state,
      prompt: 'consent'
    });

    const authUrl = `${config.wfx.authUrl}?${params.toString()}`;
    
    console.log(chalk.yellow('Visit this URL to authorize the application:'));
    console.log(chalk.cyan(authUrl));
    console.log(chalk.gray('\nAfter authorization, you\'ll be redirected to:'));
    console.log(chalk.gray(sessionData.callbackUrl));
    
  } catch (error) {
    console.log(chalk.red('❌ No active authentication session found'));
    console.log(chalk.yellow('   Please run: npm run auth'));
  }
}

showAuthUrl(); 