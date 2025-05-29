const axios = require('axios');
const config = require('./config');
const chalk = require('chalk');

async function diagnoseOAuth() {
  console.log(chalk.bold.blue('\n🔍 OAuth Configuration Diagnostics\n'));
  
  // Check environment variables
  console.log(chalk.yellow('1. Environment Variables:'));
  console.log(`   CLIENT_ID: ${config.wfx.clientId ? chalk.green('✓ Set') : chalk.red('✗ Missing')}`);
  console.log(`   CLIENT_SECRET: ${config.wfx.clientSecret ? chalk.green('✓ Set') : chalk.red('✗ Missing')}`);
  console.log(`   ACCOUNT_ID: ${config.wfx.accountId ? chalk.green('✓ Set') : chalk.red('✗ Missing')}`);
  console.log(`   CALLBACK_URL: ${config.wfx.callbackUrl}`);
  
  // Show OAuth URLs
  console.log(chalk.yellow('\n2. OAuth URLs:'));
  console.log(`   Auth URL: ${config.wfx.authUrl}`);
  console.log(`   Token URL: ${config.wfx.tokenUrl}`);
  console.log(`   API Base URL: ${config.wfx.baseUrl}`);
  
  // Test connectivity to OAuth endpoints
  console.log(chalk.yellow('\n3. Testing OAuth Endpoint Connectivity:'));
  
  try {
    console.log('   Testing auth endpoint...');
    const authResponse = await axios.get(config.wfx.authUrl, {
      timeout: 5000,
      validateStatus: () => true
    });
    console.log(`   Auth endpoint: ${chalk.green('✓ Reachable')} (Status: ${authResponse.status})`);
  } catch (error) {
    console.log(`   Auth endpoint: ${chalk.red('✗ Unreachable')} (${error.message})`);
  }
  
  try {
    console.log('   Testing token endpoint...');
    const tokenResponse = await axios.post(config.wfx.tokenUrl, {}, {
      timeout: 5000,
      validateStatus: () => true
    });
    console.log(`   Token endpoint: ${chalk.green('✓ Reachable')} (Status: ${tokenResponse.status})`);
  } catch (error) {
    console.log(`   Token endpoint: ${chalk.red('✗ Unreachable')} (${error.message})`);
  }
  
  // Generate sample auth URL
  console.log(chalk.yellow('\n4. Sample Authorization URL:'));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.wfx.clientId,
    redirect_uri: config.wfx.callbackUrl,
    scope: 'openid profile email workflowmax',
    state: 'test123'
  });
  
  const authUrl = `${config.wfx.authUrl}?${params.toString()}`;
  console.log(`   ${chalk.cyan(authUrl)}`);
  
  // Test token exchange with dummy data
  console.log(chalk.yellow('\n5. Testing Token Exchange (with dummy code):'));
  try {
    const testParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.wfx.clientId,
      client_secret: config.wfx.clientSecret,
      code: 'dummy_code',
      redirect_uri: config.wfx.callbackUrl
    });
    
    const response = await axios.post(config.wfx.tokenUrl, testParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 5000,
      validateStatus: () => true
    });
    
    console.log(`   Response Status: ${response.status}`);
    console.log(`   Response Data: ${JSON.stringify(response.data, null, 2)}`);
    
    if (response.data.error === 'invalid_client') {
      console.log(chalk.red('\n   ❌ Client authentication failed!'));
      console.log(chalk.yellow('   Possible causes:'));
      console.log('   - Invalid client_id or client_secret');
      console.log('   - OAuth app not properly configured in WorkflowMax');
      console.log('   - Credentials have been revoked or expired');
    }
  } catch (error) {
    console.log(`   Error: ${chalk.red(error.message)}`);
  }
  
  // Recommendations
  console.log(chalk.bold.blue('\n📋 Recommendations:'));
  console.log('1. Verify your OAuth credentials in WorkflowMax:');
  console.log('   - Log into WorkflowMax');
  console.log('   - Go to Settings → API → OAuth Applications');
  console.log('   - Check your app\'s Client ID and Secret');
  console.log('   - Ensure redirect URI matches exactly: ' + chalk.cyan(config.wfx.callbackUrl));
  console.log('\n2. If credentials are correct, try:');
  console.log('   - Recreating the OAuth application in WorkflowMax');
  console.log('   - Using a public URL (ngrok) instead of localhost');
  console.log('   - Checking if your WorkflowMax subscription includes API access');
  console.log('\n3. For testing with ngrok:');
  console.log('   - Install ngrok: https://ngrok.com/download');
  console.log('   - Run: ngrok http 3001');
  console.log('   - Update CALLBACK_URL in .env to the ngrok URL');
  console.log('   - Update the redirect URI in WorkflowMax OAuth app settings');
}

// Run diagnostics
diagnoseOAuth().catch(console.error); 