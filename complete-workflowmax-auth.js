const chalk = require('chalk');
const readline = require('readline');
const WorkflowMaxAuthManager = require('./src/auth-workflowmax');

async function completeAuth() {
  console.log(chalk.bold.blue('\n🔐 Complete WorkflowMax Authentication\n'));
  
  const authManager = new WorkflowMaxAuthManager();
  
  // Load the session data
  try {
    const session = await authManager.loadSessionData();
    console.log(chalk.green('✅ Found active authentication session'));
    console.log(chalk.gray(`   State: ${session.state.substring(0, 20)}...`));
    console.log(chalk.gray(`   Callback URL: ${session.callbackUrl}`));
  } catch (error) {
    console.log(chalk.red('❌ No active authentication session found'));
    console.log(chalk.yellow('   Please run: npm run auth'));
    return;
  }
  
  console.log(chalk.yellow('\nIf the browser didn\'t open, visit this URL:'));
  const authUrl = authManager.buildAuthorizationUrl();
  console.log(chalk.cyan(authUrl));
  
  console.log(chalk.yellow('\nAfter authorizing in WorkflowMax:'));
  console.log('1. You\'ll be redirected to the callback URL');
  console.log('2. Copy the ENTIRE URL from your browser (it may show an error page - that\'s normal)');
  console.log('3. Paste it below');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const callbackUrl = await new Promise(resolve => {
    rl.question(chalk.yellow('\nPaste the callback URL here: '), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
  
  try {
    // Parse the callback URL
    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    
    if (error) {
      console.log(chalk.red(`\n❌ OAuth error: ${error}`));
      console.log(chalk.red(`   Description: ${url.searchParams.get('error_description') || 'None'}`));
      return;
    }
    
    if (!code) {
      console.log(chalk.red('\n❌ No authorization code found in URL'));
      console.log(chalk.yellow('   Make sure you copied the complete URL including all parameters'));
      return;
    }
    
    console.log(chalk.gray('\n🔄 Exchanging code for tokens...'));
    console.log(chalk.gray(`   Code: ${code.substring(0, 20)}...`));
    
    // Exchange the code for tokens
    await authManager.exchangeCodeForTokens(code, state);
    
    // Verify authentication
    const status = await authManager.checkAuthStatus();
    if (status.authenticated) {
      console.log(chalk.green('\n✅ Authentication successful!'));
      console.log(chalk.gray(`   Organization ID: ${status.organizationId}`));
      console.log(chalk.gray(`   Token expires: ${status.expiresAt}`));
    }
  } catch (error) {
    console.log(chalk.red('\n❌ Error:'), error.message);
    
    if (error.message.includes('Invalid state')) {
      console.log(chalk.yellow('\nThe authentication session may have expired.'));
      console.log(chalk.yellow('Please try running the auth process again:'));
      console.log(chalk.gray('   npm run auth-clear'));
      console.log(chalk.gray('   npm run auth'));
    } else if (error.message.includes('invalid_client')) {
      console.log(chalk.yellow('\nClient authentication failed. Please check:'));
      console.log(chalk.gray('   1. Your client ID and secret in .env'));
      console.log(chalk.gray('   2. The OAuth app settings in WorkflowMax'));
    }
  }
}

completeAuth().catch(console.error); 