const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const config = require('./config');
const inquirer = require('inquirer');

/**
 * Archive old reports and clean up temporary files
 */
async function cleanup() {
  console.log(chalk.bold.blue('\n🧹 WFX Timesheet Cleanup\n'));
  
  try {
    // Check reports directory
    const reportFiles = await fs.readdir(config.directories.reports).catch(() => []);
    const excelReports = reportFiles.filter(f => f.endsWith('.xlsx'));
    
    console.log(chalk.gray(`Found ${excelReports.length} report files`));
    
    if (excelReports.length === 0) {
      console.log(chalk.yellow('No reports to clean up'));
      return;
    }
    
    // Ask user what to do
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Archive old reports (older than 30 days)', value: 'archive-old' },
          { name: 'Archive all reports', value: 'archive-all' },
          { name: 'Delete temporary files only', value: 'temp-only' },
          { name: 'Cancel', value: 'cancel' }
        ]
      }
    ]);
    
    if (action === 'cancel') {
      console.log(chalk.gray('Cleanup cancelled'));
      return;
    }
    
    // Create archive directory
    const archiveDate = new Date().toISOString().split('T')[0];
    const archiveDir = path.join(config.directories.archive, `archive_${archiveDate}`);
    await fs.mkdir(archiveDir, { recursive: true });
    
    let archivedCount = 0;
    let deletedCount = 0;
    
    // Process files based on action
    for (const file of reportFiles) {
      const filePath = path.join(config.directories.reports, file);
      const stats = await fs.stat(filePath);
      const ageInDays = (Date.now() - stats.mtime) / (1000 * 60 * 60 * 24);
      
      if (action === 'archive-all' || (action === 'archive-old' && ageInDays > 30)) {
        if (file.endsWith('.xlsx')) {
          const destPath = path.join(archiveDir, file);
          await fs.rename(filePath, destPath);
          archivedCount++;
        }
      }
    }
    
    // Clean temporary files
    const tempPatterns = ['.tmp', '.cache', '~', '.bak'];
    const allDirs = Object.values(config.directories);
    
    for (const dir of allDirs) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (tempPatterns.some(pattern => file.endsWith(pattern))) {
            await fs.unlink(path.join(dir, file));
            deletedCount++;
          }
        }
      } catch {
        // Directory might not exist
      }
    }
    
    // Clear token cache if requested
    if (action !== 'temp-only') {
      const { clearTokens } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'clearTokens',
          message: 'Clear saved authentication tokens?',
          default: false
        }
      ]);
      
      if (clearTokens) {
        try {
          await fs.unlink(path.join(config.directories.data, 'wfx_tokens.json'));
          console.log(chalk.yellow('⚠️  Authentication tokens cleared'));
        } catch {
          // Tokens might not exist
        }
      }
    }
    
    // Summary
    console.log(chalk.green('\n✅ Cleanup complete!'));
    if (archivedCount > 0) {
      console.log(chalk.gray(`📁 Archived ${archivedCount} reports to: ${archiveDir}`));
    }
    if (deletedCount > 0) {
      console.log(chalk.gray(`🗑️  Deleted ${deletedCount} temporary files`));
    }
    
    // Show disk space saved
    const reportsDirSize = await getDirSize(config.directories.reports);
    console.log(chalk.gray(`\n💾 Reports directory size: ${formatBytes(reportsDirSize)}`));
    
  } catch (error) {
    console.error(chalk.red('❌ Cleanup error:'), error.message);
  }
}

/**
 * Get directory size recursively
 */
async function getDirSize(dirPath) {
  let size = 0;
  
  try {
    const files = await fs.readdir(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isFile()) {
        size += stats.size;
      } else if (stats.isDirectory()) {
        size += await getDirSize(filePath);
      }
    }
  } catch {
    // Directory might not exist
  }
  
  return size;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run cleanup
if (require.main === module) {
  cleanup().catch(console.error);
}

module.exports = { cleanup }; 