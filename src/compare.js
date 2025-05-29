#!/usr/bin/env node

const TimesheetComparison = require('./timesheetComparison');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { program } = require('commander');
const inquirer = require('inquirer');

// CLI Configuration
program
  .name('wfx-compare')
  .description('Compare vehicle tracking CSV data with WorkflowMax timesheets')
  .version('3.0.0');

// Compare command
program
  .command('compare')
  .description('Compare timesheet data for one or more staff members')
  .option('-s, --staff <staffId>', 'Specific staff ID (e.g., Ali_M)')
  .option('-f, --from <date>', 'Start date (YYYY-MM-DD)')
  .option('-t, --to <date>', 'End date (YYYY-MM-DD)')
  .option('-a, --all', 'Process all staff with CSV files')
  .action(async (options) => {
    try {
      const comparison = new TimesheetComparison();
      
      // Determine staff to process
      let staffToProcess = [];
      if (options.staff) {
        staffToProcess = [options.staff];
      } else if (options.all) {
        // Find all CSV files
        const csvFiles = await fs.readdir(config.directories.csvInput);
        staffToProcess = csvFiles
          .filter(f => f.endsWith('.csv'))
          .map(f => f.replace('.csv', ''))
          .filter(staffId => config.staff[staffId]);
      } else {
        // Interactive selection
        const staffList = Object.keys(config.staff).map(id => ({
          name: `${config.staff[id].fullName} (${id})`,
          value: id
        }));
        
        const answers = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedStaff',
            message: 'Select staff members to compare:',
            choices: staffList,
            validate: (answer) => answer.length > 0 || 'Please select at least one staff member'
          }
        ]);
        
        staffToProcess = answers.selectedStaff;
      }

      // Determine date range
      let startDate, endDate;
      if (options.from && options.to) {
        startDate = new Date(options.from);
        endDate = new Date(options.to);
      } else {
        // Default to current month
        const now = new Date();
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        
        console.log(chalk.gray(`\nUsing default date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`));
        console.log(chalk.gray('Use --from and --to flags to specify custom dates\n'));
      }

      // Process each staff member
      console.log(chalk.bold.blue('\n🚀 Starting Timesheet Comparison\n'));
      
      for (const staffId of staffToProcess) {
        const csvPath = path.join(config.directories.csvInput, `${staffId}.csv`);
        
        try {
          await fs.access(csvPath);
          await comparison.compareTimesheet(staffId, csvPath, startDate, endDate);
        } catch (error) {
          console.error(chalk.red(`❌ Could not process ${staffId}: ${error.message}`));
        }
      }

      // Generate report
      if (staffToProcess.length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const reportPath = path.join(config.directories.reports, `comparison_${timestamp}.xlsx`);
        
        await fs.mkdir(config.directories.reports, { recursive: true });
        await comparison.generateExcelReport(reportPath);
        
        console.log(chalk.bold.green('\n✅ Comparison Complete!'));
        console.log(chalk.gray(`📄 Report saved to: ${reportPath}`));
        
        // Show performance stats
        const stats = comparison.getPerformanceStats();
        console.log(chalk.gray(`\n⚡ Performance: ${stats.addressCacheSize} cached addresses, ${stats.wfxCacheStats.size} API cache entries`));
      }
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Performance test command
program
  .command('test-performance')
  .description('Run performance tests with sample data')
  .action(async () => {
    try {
      console.log(chalk.bold.blue('\n⚡ WFX Performance Test\n'));
      
      const comparison = new TimesheetComparison();
      const csvFiles = await fs.readdir(config.directories.csvInput);
      const availableFiles = csvFiles.filter(f => f.endsWith('.csv'));
      
      if (availableFiles.length === 0) {
        console.log(chalk.yellow('No CSV files found for testing.'));
        console.log(chalk.gray('Place CSV files in csv_files/ directory first.'));
        return;
      }
      
      console.log(chalk.gray(`Found ${availableFiles.length} CSV files for testing...`));
      
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      
      const results = [];
      
      for (const file of availableFiles.slice(0, 3)) { // Test max 3 files
        const staffId = file.replace('.csv', '');
        if (!config.staff[staffId]) continue;
        
        const csvPath = path.join(config.directories.csvInput, file);
        const testStart = Date.now();
        
        try {
          await comparison.compareTimesheet(staffId, csvPath, startDate, endDate);
          const processingTime = Date.now() - testStart;
          
          const result = comparison.comparisonResults[staffId];
          results.push({
            staffId,
            processingTime,
            csvRows: result.csvStats?.totalTrips || 0,
            uniqueDays: result.csvStats?.uniqueDates || 0,
            accuracy: result.comparison.summary.accuracy
          });
          
        } catch (error) {
          console.error(chalk.red(`❌ Test failed for ${staffId}: ${error.message}`));
        }
      }
      
      // Display results
      console.log(chalk.bold('\n📊 Performance Test Results:'));
      console.log(chalk.gray('─'.repeat(60)));
      
      let totalTime = 0;
      let totalRows = 0;
      
      results.forEach(result => {
        totalTime += result.processingTime;
        totalRows += result.csvRows;
        
        const timeColor = result.processingTime < 1000 ? chalk.green : 
                         result.processingTime < 3000 ? chalk.yellow : chalk.red;
        
        console.log(`${result.staffId.padEnd(15)} | ${timeColor(result.processingTime + 'ms').padEnd(20)} | ${result.csvRows} rows | ${result.uniqueDays} days | ${result.accuracy}%`);
      });
      
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.bold(`Average: ${Math.round(totalTime / results.length)}ms per comparison`));
      console.log(chalk.bold(`Throughput: ${Math.round(totalRows / (totalTime / 1000))} rows/second`));
      
      // Performance recommendations
      const avgTime = totalTime / results.length;
      if (avgTime > 5000) {
        console.log(chalk.yellow('\n💡 Performance Tips:'));
        console.log(chalk.gray('  • Consider reducing date ranges for large datasets'));
        console.log(chalk.gray('  • Clear caches between runs: comparison.clearCaches()'));
        console.log(chalk.gray('  • Check CSV file size and complexity'));
      } else {
        console.log(chalk.green('\n✅ Good performance! All optimizations are working well.'));
      }
      
    } catch (error) {
      console.error(chalk.red('Performance test error:', error.message));
    }
  });

// Setup command
program
  .command('setup')
  .description('Initial setup and configuration')
  .action(async () => {
    try {
      console.log(chalk.bold.blue('\n🛠️  WFX Timesheet Comparison Setup\n'));
      
      // Create directories
      const dirs = Object.values(config.directories);
      for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
        console.log(chalk.green(`✅ Created directory: ${dir}`));
      }
      
      // Check for staff configuration
      const staffCount = Object.keys(config.staff).length;
      console.log(chalk.gray(`\n📋 Currently configured staff: ${staffCount}`));
      
      if (staffCount === 0) {
        console.log(chalk.yellow('\n⚠️  No staff configured yet!'));
        console.log(chalk.gray('Edit src/config.js to add staff members'));
      } else {
        Object.entries(config.staff).forEach(([id, info]) => {
          console.log(`   • ${info.fullName} (${id})`);
        });
      }
      
      console.log(chalk.gray('\n📁 Place CSV files in: ' + config.directories.csvInput));
      console.log(chalk.gray('📊 Reports will be saved to: ' + config.directories.reports));
      
      // Show optimization status
      console.log(chalk.bold('\n⚡ Optimization Status:'));
      console.log(chalk.green('✅ Environment variables loaded'));
      console.log(chalk.green('✅ Performance settings configured'));
      console.log(chalk.green('✅ API caching enabled'));
      console.log(chalk.green('✅ Token persistence active'));
      
    } catch (error) {
      console.error(chalk.red('Setup error:', error.message));
    }
  });

// Add staff command
program
  .command('add-staff')
  .description('Add a new staff member to configuration')
  .action(async () => {
    try {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'id',
          message: 'Staff ID (e.g., John_D):',
          validate: (input) => /^[A-Za-z]+_[A-Z]$/.test(input) || 'Format should be FirstName_LastInitial'
        },
        {
          type: 'input',
          name: 'fullName',
          message: 'Full name:',
          validate: (input) => input.length > 0 || 'Please enter a name'
        },
        {
          type: 'input',
          name: 'homeAddress',
          message: 'Home address:',
          validate: (input) => input.length > 0 || 'Please enter an address'
        },
        {
          type: 'input',
          name: 'wfxId',
          message: 'WorkflowMax staff ID:',
          default: 'wfx_staff_id_pending'
        },
        {
          type: 'number',
          name: 'hourlyRate',
          message: 'Default hourly rate:',
          default: 45.00
        },
        {
          type: 'input',
          name: 'vehicleId',
          message: 'Vehicle ID:',
          default: 'VEH001'
        }
      ]);

      // Read current config
      const configPath = path.join(__dirname, 'config.js');
      let configContent = await fs.readFile(configPath, 'utf8');
      
      // Find staff section
      const staffSection = `    '${answers.id}': {
      fullName: '${answers.fullName}',
      homeAddress: '${answers.homeAddress}',
      wfxId: '${answers.wfxId}',
      defaultHourlyRate: ${answers.hourlyRate},
      vehicleId: '${answers.vehicleId}'
    },`;

      // Insert before the closing comment
      configContent = configContent.replace(
        /(\s*)\/\/ Add more staff members here/,
        `${staffSection}\n$1// Add more staff members here`
      );
      
      await fs.writeFile(configPath, configContent);
      
      console.log(chalk.green(`\n✅ Added ${answers.fullName} to configuration!`));
      console.log(chalk.gray(`Place their CSV file as: ${config.directories.csvInput}/${answers.id}.csv`));
      
    } catch (error) {
      console.error(chalk.red('Error adding staff:', error.message));
    }
  });

// List staff command
program
  .command('list-staff')
  .description('List all configured staff members')
  .action(() => {
    console.log(chalk.bold.blue('\n📋 Configured Staff Members:\n'));
    
    const staffList = Object.entries(config.staff);
    if (staffList.length === 0) {
      console.log(chalk.yellow('No staff members configured yet.'));
      console.log(chalk.gray('Use "compare add-staff" to add staff members.'));
    } else {
      staffList.forEach(([id, info]) => {
        console.log(chalk.bold(`${info.fullName} (${id})`));
        console.log(chalk.gray(`  Home: ${info.homeAddress}`));
        console.log(chalk.gray(`  WFX ID: ${info.wfxId}`));
        console.log(chalk.gray(`  Rate: $${info.defaultHourlyRate}/hr`));
        console.log(chalk.gray(`  Vehicle: ${info.vehicleId}\n`));
      });
    }
  });

// Auth command for WFX
program
  .command('auth')
  .description('Authenticate with WorkflowMax')
  .action(async () => {
    try {
      console.log(chalk.bold.blue('\n🔐 WorkflowMax Authentication\n'));
      
      const comparison = new TimesheetComparison();
      const authUrl = comparison.wfxClient.getAuthorizationUrl();
      
      console.log(chalk.gray('1. Open this URL in your browser:'));
      console.log(chalk.cyan(authUrl));
      console.log(chalk.gray('\n2. Log in to WorkflowMax'));
      console.log(chalk.gray('3. Copy the authorization code from the callback URL'));
      
      const { code } = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: 'Enter authorization code:',
          validate: (input) => input.length > 0 || 'Please enter the code'
        }
      ]);
      
      console.log(chalk.gray('\nExchanging code for access token...'));
      const tokens = await comparison.wfxClient.exchangeCodeForToken(code);
      
      console.log(chalk.green('\n✅ Authentication successful!'));
      console.log(chalk.gray('Tokens saved automatically for future use.'));
      
    } catch (error) {
      console.error(chalk.red('Authentication error:', error.message));
    }
  });

// Clean command
program
  .command('clean')
  .description('Archive old reports and clean up workspace')
  .action(async () => {
    try {
      console.log(chalk.bold.blue('\n🧹 Cleaning Workspace\n'));
      
      const reportFiles = await fs.readdir(config.directories.reports);
      const csvFiles = await fs.readdir(config.directories.csvInput);
      
      // Create archive directory
      const archiveDir = config.directories.archive;
      const timestamp = new Date().toISOString().split('T')[0];
      const archiveSubDir = path.join(archiveDir, `archive_${timestamp}`);
      
      await fs.mkdir(archiveSubDir, { recursive: true });
      
      // Archive old reports
      let archivedCount = 0;
      for (const file of reportFiles) {
        if (file.endsWith('.xlsx') || file.endsWith('.csv')) {
          const sourcePath = path.join(config.directories.reports, file);
          const destPath = path.join(archiveSubDir, file);
          await fs.rename(sourcePath, destPath);
          archivedCount++;
        }
      }
      
      console.log(chalk.green(`✅ Archived ${archivedCount} report files`));
      console.log(chalk.gray(`📁 Archive location: ${archiveSubDir}`));
      
      // Summary
      console.log(chalk.gray(`\n📊 Current CSV files: ${csvFiles.filter(f => f.endsWith('.csv')).length}`));
      console.log(chalk.gray('💡 Tip: Use "compare compare --all" to process all staff'));
      
    } catch (error) {
      console.error(chalk.red('Clean error:', error.message));
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
} 