const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

async function setup() {
  console.log(chalk.bold.blue('\n🚀 WFX Timesheet Comparison Tool - Setup\n'));

  // Check if .env exists
  try {
    await fs.access('.env');
    console.log(chalk.green('✅ .env file found'));
  } catch {
    console.log(chalk.yellow('⚠️  No .env file found'));
    console.log(chalk.gray('   Creating .env.example...'));
    
    const envExample = `# WorkflowMax OAuth credentials
WFX_CLIENT_ID=your-client-id
WFX_CLIENT_SECRET=your-client-secret
WFX_ACCOUNT_ID=your-account-id

# OAuth URLs (WorkflowMax platform)
WFX_AUTH_URL=https://oauth.workflowmax.com/oauth/authorize
WFX_TOKEN_URL=https://oauth.workflowmax.com/oauth/token
WFX_BASE_URL=https://api.workflowmax.com/api/2.0

# Local server configuration
PORT=3000
CALLBACK_URL=https://your-ngrok-url.ngrok-free.app/oauth/callback

# OAuth scopes
OAUTH_SCOPES=openid profile email workflowmax offline_access

# Debug settings
DEBUG_AUTH=false
DEBUG_API=false

# Session settings
SESSION_SECRET=change-this-to-a-random-string

# Token storage
TOKEN_STORAGE_PATH=./data/wfx_tokens.json`;

    await fs.writeFile('.env.example', envExample);
    console.log(chalk.green('✅ Created .env.example'));
    console.log(chalk.yellow('\n📝 Next steps:'));
    console.log('   1. Copy .env.example to .env');
    console.log('   2. Fill in your WorkflowMax OAuth credentials');
    console.log('   3. Set up ngrok and update CALLBACK_URL');
    console.log('   4. Run npm start');
  }

  // Create necessary directories
  const dirs = ['data', 'csv_files', 'reports', 'webapp', 'archive'];
  
  console.log(chalk.gray('\nCreating directories...'));
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(chalk.green(`✅ ${dir}/`));
    } catch (error) {
      console.log(chalk.red(`❌ ${dir}/ - ${error.message}`));
    }
  }

  // Check for CSV files
  try {
    const files = await fs.readdir('csv_files');
    const csvFiles = files.filter(f => f.endsWith('.csv'));
    if (csvFiles.length > 0) {
      console.log(chalk.green(`\n✅ Found ${csvFiles.length} CSV files`));
      csvFiles.forEach(f => console.log(chalk.gray(`   - ${f}`)));
    } else {
      console.log(chalk.yellow('\n⚠️  No CSV files found in csv_files/'));
      console.log(chalk.gray('   Add CSV files named like: FirstName_LastInitial.csv'));
    }
  } catch {
    console.log(chalk.yellow('\n⚠️  Could not read csv_files directory'));
  }

  console.log(chalk.bold.blue('\n✨ Setup complete!\n'));
  console.log(chalk.yellow('Quick start commands:'));
  console.log(chalk.gray('  npm install        # Install dependencies'));
  console.log(chalk.gray('  npm run auth       # Authenticate with WorkflowMax'));
  console.log(chalk.gray('  npm start          # Start the dashboard'));
  console.log(chalk.gray('\nFor detailed instructions, see README.md'));
}

setup().catch(console.error); 