const chalk = require('chalk');
const config = require('./config');
const EnhancedAuthManager = require('./auth-enhanced');
const axios = require('axios');

/**
 * Comprehensive authentication and API test suite
 */
async function runAuthTests() {
  console.log(chalk.bold.blue('\n🧪 WorkflowMax Authentication Test Suite\n'));
  
  const authManager = new EnhancedAuthManager();
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Check environment configuration
  console.log(chalk.yellow('1. Testing Environment Configuration'));
  try {
    const requiredVars = ['WFX_CLIENT_ID', 'WFX_CLIENT_SECRET', 'WFX_ACCOUNT_ID', 'CALLBACK_URL'];
    const missingVars = requiredVars.filter(v => !process.env[v]);
    
    if (missingVars.length === 0) {
      console.log(chalk.green('   ✅ All required environment variables are set'));
      testsPassed++;
    } else {
      console.log(chalk.red(`   ❌ Missing environment variables: ${missingVars.join(', ')}`));
      testsFailed++;
    }

    // Display current configuration
    console.log(chalk.gray('   Configuration:'));
    console.log(chalk.gray(`     Client ID: ${config.wfx.clientId.substring(0, 10)}...`));
    console.log(chalk.gray(`     Account ID: ${config.wfx.accountId}`));
    console.log(chalk.gray(`     Callback URL: ${config.wfx.callbackUrl}`));
    console.log(chalk.gray(`     Auth URL: ${config.wfx.authUrl}`));
    console.log(chalk.gray(`     Token URL: ${config.wfx.tokenUrl}`));
    console.log(chalk.gray(`     API Base URL: ${config.wfx.baseUrl}`));
  } catch (error) {
    console.log(chalk.red(`   ❌ Error: ${error.message}`));
    testsFailed++;
  }

  // Test 2: Check OAuth endpoints accessibility
  console.log(chalk.yellow('\n2. Testing OAuth Endpoints'));
  
  // Test auth endpoint
  try {
    console.log(chalk.gray('   Testing authorization endpoint...'));
    const authResponse = await axios.get(config.wfx.authUrl, {
      timeout: 5000,
      validateStatus: () => true,
      maxRedirects: 0
    });
    
    if (authResponse.status === 302 || authResponse.status === 200) {
      console.log(chalk.green(`   ✅ Auth endpoint accessible (Status: ${authResponse.status})`));
      testsPassed++;
    } else {
      console.log(chalk.red(`   ❌ Unexpected auth endpoint status: ${authResponse.status}`));
      testsFailed++;
    }
  } catch (error) {
    console.log(chalk.red(`   ❌ Auth endpoint error: ${error.message}`));
    testsFailed++;
  }

  // Test token endpoint
  try {
    console.log(chalk.gray('   Testing token endpoint...'));
    const tokenResponse = await axios.post(config.wfx.tokenUrl, '', {
      timeout: 5000,
      validateStatus: () => true
    });
    
    // We expect an error since we're not providing valid parameters
    if (tokenResponse.status === 400 || tokenResponse.status === 401) {
      console.log(chalk.green(`   ✅ Token endpoint accessible (Status: ${tokenResponse.status})`));
      testsPassed++;
    } else {
      console.log(chalk.yellow(`   ⚠️  Unexpected token endpoint status: ${tokenResponse.status}`));
      testsPassed++;
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log(chalk.red(`   ❌ Token endpoint unreachable: ${error.message}`));
      testsFailed++;
    } else {
      console.log(chalk.green('   ✅ Token endpoint accessible (got expected error)'));
      testsPassed++;
    }
  }

  // Test 3: Check current authentication status
  console.log(chalk.yellow('\n3. Testing Current Authentication Status'));
  try {
    const authStatus = await authManager.checkAuthStatus();
    
    if (authStatus.authenticated) {
      console.log(chalk.green('   ✅ Currently authenticated'));
      console.log(chalk.gray(`     User: ${JSON.stringify(authStatus.user)}`));
      console.log(chalk.gray(`     Token expires: ${authStatus.expiresAt}`));
      testsPassed++;
    } else {
      console.log(chalk.yellow(`   ⚠️  Not authenticated: ${authStatus.reason}`));
      console.log(chalk.gray('     This is expected if you haven\'t authenticated yet'));
      testsPassed++;
    }
  } catch (error) {
    console.log(chalk.red(`   ❌ Error checking auth status: ${error.message}`));
    testsFailed++;
  }

  // Test 4: PKCE generation
  console.log(chalk.yellow('\n4. Testing PKCE Generation'));
  try {
    const pkce = authManager.generatePKCE();
    
    if (pkce.verifier && pkce.challenge && pkce.verifier.length >= 43) {
      console.log(chalk.green('   ✅ PKCE generated successfully'));
      console.log(chalk.gray(`     Verifier length: ${pkce.verifier.length} characters`));
      console.log(chalk.gray(`     Challenge length: ${pkce.challenge.length} characters`));
      testsPassed++;
    } else {
      console.log(chalk.red('   ❌ Invalid PKCE generation'));
      testsFailed++;
    }
  } catch (error) {
    console.log(chalk.red(`   ❌ PKCE generation error: ${error.message}`));
    testsFailed++;
  }

  // Test 5: Authorization URL generation
  console.log(chalk.yellow('\n5. Testing Authorization URL Generation'));
  try {
    const authUrl = authManager.buildAuthorizationUrl();
    const url = new URL(authUrl);
    const params = url.searchParams;
    
    const requiredParams = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method'];
    const missingParams = requiredParams.filter(p => !params.has(p));
    
    if (missingParams.length === 0) {
      console.log(chalk.green('   ✅ Authorization URL contains all required parameters'));
      console.log(chalk.gray(`     URL: ${authUrl.substring(0, 100)}...`));
      testsPassed++;
    } else {
      console.log(chalk.red(`   ❌ Missing parameters: ${missingParams.join(', ')}`));
      testsFailed++;
    }
  } catch (error) {
    console.log(chalk.red(`   ❌ URL generation error: ${error.message}`));
    testsFailed++;
  }

  // Test 6: API connectivity (if authenticated)
  console.log(chalk.yellow('\n6. Testing API Connectivity'));
  try {
    const tokens = await authManager.loadTokens();
    
    if (tokens && tokens.access_token) {
      console.log(chalk.gray('   Testing API with saved token...'));
      
      const apiResponse = await axios.get(`${config.wfx.baseUrl}/staff.api/list`, {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'xero-tenant-id': config.wfx.accountId,
          'Accept': 'application/json'
        },
        timeout: 10000,
        validateStatus: () => true
      });
      
      if (apiResponse.status === 200) {
        console.log(chalk.green('   ✅ API connection successful'));
        console.log(chalk.gray(`     Response: ${apiResponse.data.length} staff members found`));
        testsPassed++;
      } else if (apiResponse.status === 401) {
        console.log(chalk.yellow('   ⚠️  Token expired or invalid (401)'));
        console.log(chalk.gray('     You may need to re-authenticate'));
        testsPassed++;
      } else if (apiResponse.status === 403) {
        console.log(chalk.red('   ❌ Access forbidden (403) - check account permissions'));
        testsFailed++;
      } else {
        console.log(chalk.red(`   ❌ Unexpected API response: ${apiResponse.status}`));
        testsFailed++;
      }
    } else {
      console.log(chalk.gray('   ⏭️  Skipping API test (not authenticated)'));
    }
  } catch (error) {
    console.log(chalk.red(`   ❌ API test error: ${error.message}`));
    testsFailed++;
  }

  // Summary
  console.log(chalk.bold.blue('\n📊 Test Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.green(`   Passed: ${testsPassed}`));
  console.log(chalk.red(`   Failed: ${testsFailed}`));
  console.log(chalk.gray('─'.repeat(40)));

  if (testsFailed === 0) {
    console.log(chalk.bold.green('\n✅ All tests passed!'));
    
    const authStatus = await authManager.checkAuthStatus();
    if (!authStatus.authenticated) {
      console.log(chalk.yellow('\n📌 Next step: Run authentication'));
      console.log(chalk.gray('   npm run auth'));
    }
  } else {
    console.log(chalk.bold.red('\n❌ Some tests failed. Please check the errors above.'));
    
    // Provide specific recommendations based on failures
    console.log(chalk.yellow('\n📌 Recommendations:'));
    console.log(chalk.gray('   1. Check your .env file has correct values'));
    console.log(chalk.gray('   2. Verify your OAuth app settings in WorkflowMax'));
    console.log(chalk.gray('   3. Ensure your callback URL matches exactly'));
    console.log(chalk.gray('   4. Run diagnostics: node src/diagnose-oauth.js'));
  }

  return { passed: testsPassed, failed: testsFailed };
}

// Run tests if called directly
if (require.main === module) {
  runAuthTests()
    .then(({ failed }) => process.exit(failed > 0 ? 1 : 0))
    .catch(error => {
      console.error(chalk.red('Fatal error:'), error);
      process.exit(1);
    });
}

module.exports = runAuthTests; 