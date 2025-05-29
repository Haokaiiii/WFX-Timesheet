const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const inquirer = require('inquirer');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const config = require('./config');

// Check if all required dependencies are installed
async function checkDependencies() {
  console.log(chalk.gray('Checking dependencies...'));
  
  try {
    // Check core dependencies
    const requiredModules = ['axios', 'chalk', 'express', 'csv-parse', 'exceljs', 'inquirer', 'commander', 'cors', 'open'];
    const missing = [];
    
    for (const module of requiredModules) {
      try {
        require.resolve(module);
      } catch {
        missing.push(module);
      }
    }
    
    if (missing.length > 0) {
      console.log(chalk.yellow('⚠️  Missing dependencies detected'));
      console.log(chalk.gray('Installing missing packages...'));
      
      const { stdout } = await execAsync(`npm install ${missing.join(' ')}`, { cwd: process.cwd() });
      console.log(chalk.green('✅ Dependencies installed'));
    } else {
      console.log(chalk.green('✅ All dependencies installed'));
    }
    
    return true;
  } catch (error) {
    console.error(chalk.red('❌ Failed to check/install dependencies'), error.message);
    return false;
  }
}

// Check if environment is configured
async function checkEnvironment() {
  console.log(chalk.gray('\nChecking environment configuration...'));
  
  const issues = [];
  
  // Check .env file
  try {
    await fs.access('.env');
    console.log(chalk.green('✅ .env file found'));
  } catch {
    issues.push('No .env file found');
  }
  
  // Check OAuth credentials
  if (!config.wfx.clientId || config.wfx.clientId === 'your_client_id_here') {
    issues.push('WFX_CLIENT_ID not configured in .env');
  }
  if (!config.wfx.clientSecret || config.wfx.clientSecret === 'your_client_secret_here') {
    issues.push('WFX_CLIENT_SECRET not configured in .env');
  }
  
  // Check directories
  for (const [name, dir] of Object.entries(config.directories)) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
      console.log(chalk.gray(`  Created directory: ${dir}`));
    }
  }
  
  if (issues.length > 0) {
    console.log(chalk.yellow('\n⚠️  Configuration issues found:'));
    issues.forEach(issue => console.log(chalk.yellow(`  • ${issue}`)));
    return false;
  }
  
  console.log(chalk.green('✅ Environment configured correctly'));
  return true;
}

// Check authentication status
async function checkAuthentication() {
  console.log(chalk.gray('\nChecking WorkflowMax authentication...'));
  
  try {
    const AuthManager = require('./auth');
    const authManager = new AuthManager();
    
    const isAuthenticated = await authManager.checkAuthStatus();
    
    if (!isAuthenticated) {
      console.log(chalk.yellow('⚠️  Not authenticated with WorkflowMax'));
    }
    
    return isAuthenticated;
  } catch (error) {
    console.log(chalk.red('❌ Authentication check failed'), error.message);
    return false;
  }
}

// Check for CSV files
async function checkCSVFiles() {
  console.log(chalk.gray('\nChecking for CSV files...'));
  
  try {
    const files = await fs.readdir(config.directories.csvInput);
    const csvFiles = files.filter(f => f.endsWith('.csv'));
    
    if (csvFiles.length === 0) {
      console.log(chalk.yellow('⚠️  No CSV files found in csv_files/'));
      console.log(chalk.gray('  Place your vehicle tracking CSV files in the csv_files/ directory'));
      return false;
    }
    
    console.log(chalk.green(`✅ Found ${csvFiles.length} CSV files:`));
    csvFiles.forEach(file => {
      const staffId = file.replace('.csv', '');
      const isConfigured = config.staff[staffId];
      console.log(chalk.gray(`  • ${file} ${isConfigured ? '✓' : '(no staff config)'}`));
    });
    
    return true;
  } catch (error) {
    console.log(chalk.red('❌ Failed to check CSV files'), error.message);
    return false;
  }
}

// Check staff configuration
async function checkStaffConfig() {
  console.log(chalk.gray('\nChecking staff configuration...'));
  
  const staffCount = Object.keys(config.staff).length;
  
  if (staffCount === 0) {
    console.log(chalk.yellow('⚠️  No staff members configured'));
    console.log(chalk.gray('  Add staff members to src/config.js'));
    return false;
  }
  
  console.log(chalk.green(`✅ ${staffCount} staff members configured:`));
  Object.entries(config.staff).forEach(([id, info]) => {
    console.log(chalk.gray(`  • ${info.fullName} (${id})`));
  });
  
  return true;
}

// Run quick start
async function runQuickStart() {
  console.log(chalk.bold.blue('\n🚀 WFX Timesheet Comparison Quick Start\n'));
  
  // Run all checks
  const checks = {
    dependencies: await checkDependencies(),
    environment: await checkEnvironment(),
    authentication: await checkAuthentication(),
    csvFiles: await checkCSVFiles(),
    staffConfig: await checkStaffConfig()
  };
  
  // Summary
  console.log(chalk.bold('\n📊 System Status Summary:'));
  console.log(chalk.gray('─'.repeat(50)));
  
  const allGood = Object.values(checks).every(status => status);
  
  if (allGood) {
    console.log(chalk.green.bold('\n✅ Everything is set up correctly!'));
    
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📊 Start Dashboard', value: 'dashboard' },
          { name: '🔄 Run Comparison', value: 'compare' },
          { name: '📋 View Staff List', value: 'staff' },
          { name: '🚪 Exit', value: 'exit' }
        ]
      }
    ]);
    
    switch (action) {
      case 'dashboard':
        console.log(chalk.gray('\nStarting dashboard...'));
        console.log(chalk.green('Run: npm start'));
        break;
      case 'compare':
        console.log(chalk.gray('\nRun comparison...'));
        console.log(chalk.green('Run: npm run compare'));
        break;
      case 'staff':
        console.log(chalk.gray('\nView staff configuration...'));
        console.log(chalk.green('Run: node src/compare.js list-staff'));
        break;
    }
  } else {
    console.log(chalk.yellow.bold('\n⚠️  Some setup steps are needed:'));
    
    if (!checks.environment) {
      console.log(chalk.yellow('\n1. Configure OAuth credentials:'));
      console.log(chalk.gray('   • Copy .env.example to .env'));
      console.log(chalk.gray('   • Add your WFX_CLIENT_ID and WFX_CLIENT_SECRET'));
    }
    
    if (!checks.authentication) {
      console.log(chalk.yellow('\n2. Authenticate with WorkflowMax:'));
      console.log(chalk.gray('   • Run: npm run auth'));
      console.log(chalk.gray('   • The tool will automatically detect the best method'));
      console.log(chalk.gray('   • Follow the prompts to complete authentication'));
    }
    
    if (!checks.staffConfig) {
      console.log(chalk.yellow('\n3. Configure staff members:'));
      console.log(chalk.gray('   • Edit src/config.js'));
      console.log(chalk.gray('   • Or run: node src/compare.js add-staff'));
    }
    
    if (!checks.csvFiles) {
      console.log(chalk.yellow('\n4. Add CSV files:'));
      console.log(chalk.gray('   • Place vehicle tracking CSV files in csv_files/'));
      console.log(chalk.gray('   • Name them as StaffID.csv (e.g., Ali_M.csv)'));
    }
  }
  
  console.log(chalk.gray('\n💡 For detailed documentation, check README.md'));
}

// Command-line interface
program
  .name('quick-start')
  .description('Quick start guide and system checker')
  .action(runQuickStart);

program.parse(process.argv);

// If no command, run quick start
if (!process.argv.slice(2).length) {
  runQuickStart().catch(console.error);
} 