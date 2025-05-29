const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const config = require('./config');
const TimesheetComparison = require('./timesheetComparison');
const chalk = require('chalk');
const WorkflowMaxAuthManager = require('./auth-workflowmax');
const WFXApiClient = require('./wfxApi');

// Create a singleton instance of Auth Manager for status checks
const authManager = new WorkflowMaxAuthManager();

const app = express();
const PORT = config.server.port;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'webapp')));

// Store comparison results in memory
let comparisonCache = {};

// Performance monitoring
const performanceStats = {
  requests: 0,
  errors: 0,
  startTime: Date.now()
};

// Middleware for performance tracking
app.use((req, res, next) => {
  performanceStats.requests++;
  next();
});

// API Routes
app.get('/api/staff', (req, res) => {
  res.json(config.staff);
});

app.get('/api/config', (req, res) => {
  res.json({
    alerts: config.alerts,
    processing: config.processing,
    performance: config.performance
  });
});

app.get('/api/stats', (req, res) => {
  const uptime = Date.now() - performanceStats.startTime;
  res.json({
    ...performanceStats,
    uptime: Math.round(uptime / 1000),
    cacheSize: Object.keys(comparisonCache).length
  });
});

app.post('/api/compare', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { staffId, startDate, endDate } = req.body;
    
    if (!staffId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required parameters: staffId, startDate, endDate' });
    }
    if (!config.staff[staffId]) {
      return res.status(400).json({ error: 'Staff not found' });
    }
    
    const csvPath = path.join(config.directories.csvInput, `${staffId}.csv`);
    await fs.access(csvPath);
    
    const comparison = new TimesheetComparison();
    await comparison.compareTimesheet(
      staffId, 
      csvPath, 
      new Date(startDate), 
      new Date(endDate)
    );
    
    comparisonCache[staffId] = comparison.comparisonResults[staffId];
    
    const processingTime = Date.now() - startTime;
    const result = comparison.comparisonResults[staffId];
    result.metadata.apiProcessingTime = processingTime;
    
    res.json(result);
  } catch (error) {
    performanceStats.errors++;
    console.error('Comparison error:', error);
    res.status(500).json({ 
      error: error.message,
      processingTime: Date.now() - startTime
    });
  }
});

app.get('/api/results/:staffId', (req, res) => {
  const { staffId } = req.params;
  const result = comparisonCache[staffId];
  if (!result) {
    return res.status(404).json({ error: 'No results found for this staff member' });
  }
  res.json(result);
});

app.get('/api/summary', (req, res) => {
  const summary = Object.entries(comparisonCache).map(([staffId, result]) => ({
    staffId,
    fullName: result.staffConfig.fullName,
    accuracy: parseFloat(result.comparison.summary.accuracy),
    totalDays: result.comparison.summary.totalDays,
    discrepancyDays: result.comparison.summary.discrepancyDays,
    totalCsvHours: result.comparison.summary.totalCsvHours,
    totalWfxHours: result.comparison.summary.totalWfxHours,
    alerts: result.comparison.summary.alerts.length,
    totalDistance: result.csvStats?.totalDistance || 0,
    totalTrips: result.csvStats?.totalTrips || 0,
    processedAt: result.metadata.processedAt
  }));
  summary.sort((a, b) => a.accuracy - b.accuracy);
  res.json(summary);
});

app.post('/api/cache/clear', (req, res) => {
  comparisonCache = {};
  console.log(chalk.yellow('Comparison cache cleared. WFX API cache in WFXApiClient will be cleared on next API call if implementation supports it.'));
  res.json({ message: 'Cache cleared successfully' });
});

// Add authentication status endpoint using WorkflowMaxAuthManager
app.get('/api/auth/status', async (req, res) => {
  try {
    console.log(chalk.gray('📋 Checking auth status...'));
    const status = await authManager.checkAuthStatus();
    console.log(chalk.gray('📋 Auth status result:'), status);
    res.json(status);
  } catch (error) {
    console.error(chalk.red('Error checking auth status in dashboard:'), error);
    console.error(chalk.red('Error stack:'), error.stack);
    res.status(500).json({ authenticated: false, reason: 'Error checking status: ' + error.message });
  }
});

// Add endpoint to fetch actual WFX staff list
app.get('/api/wfx/staff', async (req, res) => {
  try {
    const wfxClient = new WFXApiClient();
    const staff = await wfxClient.getStaff();
    console.log(chalk.gray('📋 WFX Staff API Response:'));
    console.log(chalk.gray(`  Type: ${typeof staff}`));
    console.log(chalk.gray(`  Is Array: ${Array.isArray(staff)}`));
    if (staff && typeof staff === 'object') {
      console.log(chalk.gray(`  Keys: ${Object.keys(staff).join(', ')}`));
      // Log first few items to understand structure
      if (Array.isArray(staff) && staff.length > 0) {
        console.log(chalk.gray(`  First item: ${JSON.stringify(staff[0], null, 2)}`));
      } else if (staff.Staff && Array.isArray(staff.Staff)) {
        console.log(chalk.gray(`  Staff array length: ${staff.Staff.length}`));
        if (staff.Staff.length > 0) {
          console.log(chalk.gray(`  First staff: ${JSON.stringify(staff.Staff[0], null, 2)}`));
        }
      }
    }
    res.json(staff);
  } catch (error) {
    console.error(chalk.red('Error fetching WFX staff:'), error);
    res.status(500).json({ error: error.message });
  }
});

// Create webapp directory and HTML file if they don't exist
async function setupWebapp() {
  const webappDir = path.join(__dirname, '..', 'webapp');
  await fs.mkdir(webappDir, { recursive: true });
  
  const indexPath = path.join(webappDir, 'index.html');
  try {
    await fs.access(indexPath);
  } catch {
    // Create default index.html
    await fs.writeFile(indexPath, getDefaultHTML());
  }
}

// Start server
async function startServer() {
  await setupWebapp();
  
  app.listen(PORT, () => {
    console.log(chalk.bold.blue('\n🚀 WFX Timesheet Dashboard'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.green(`✅ Server running at http://localhost:${PORT}`));
    console.log(chalk.gray('\nOptimizations Active:'));
    console.log(chalk.gray('  • Environment variables loaded'));
    console.log(chalk.gray('  • API caching enabled'));
    console.log(chalk.gray('  • Performance monitoring active'));
    console.log(chalk.gray('\nAvailable endpoints:'));
    console.log(chalk.gray('  • GET  /api/staff - List all staff'));
    console.log(chalk.gray('  • POST /api/compare - Run comparison'));
    console.log(chalk.gray('  • GET  /api/results/:staffId - Get results'));
    console.log(chalk.gray('  • GET  /api/summary - Get all summaries'));
    console.log(chalk.gray('  • GET  /api/stats - Performance statistics'));
    console.log(chalk.gray('  • POST /api/cache/clear - Clear cache'));
    console.log(chalk.gray('\nRun `npm run auth-status` to check WFX auth.'));
    console.log(chalk.gray('Run `npm run auth` to authenticate with WorkflowMax.'));
    console.log(chalk.gray('\nPress Ctrl+C to stop the server'));
  });
}

// Default HTML template (updated with performance improvements)
function getDefaultHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WFX Timesheet Comparison Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #f5f5f7;
            color: #333;
        }
        
        .header {
            background-color: #4472C4;
            color: white;
            padding: 1rem 2rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .stats-indicator {
            font-size: 0.9rem;
            opacity: 0.9;
        }
        
        .auth-status {
            font-size: 0.9rem;
            margin-right: 1rem;
        }
        
        .auth-status.authenticated {
            color: #90EE90;
        }
        
        .auth-status.not-authenticated {
            color: #FFB6C1;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .card {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .card h2 {
            margin-bottom: 1rem;
            color: #4472C4;
        }
        
        .controls {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            align-items: end;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        
        label {
            font-weight: 500;
            font-size: 0.9rem;
        }
        
        select, input[type="date"] {
            padding: 0.5rem;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 1rem;
        }
        
        button {
            background-color: #4472C4;
            color: white;
            border: none;
            padding: 0.5rem 1.5rem;
            border-radius: 4px;
            font-size: 1rem;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        button:hover {
            background-color: #3056a0;
        }
        
        button:disabled {
            background-color: #ccc;
            cursor: not-allowed;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }
        
        .summary-item {
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 4px;
            text-align: center;
        }
        
        .summary-value {
            font-size: 2rem;
            font-weight: 600;
            color: #4472C4;
        }
        
        .summary-label {
            font-size: 0.9rem;
            color: #666;
            margin-top: 0.25rem;
        }
        
        .alert {
            padding: 0.75rem 1rem;
            border-radius: 4px;
            margin-bottom: 0.5rem;
        }
        
        .alert-warning {
            background-color: #fff3cd;
            color: #856404;
            border: 1px solid #ffeeba;
        }
        
        .alert-error {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .alert-info {
            background-color: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        
        .loading {
            text-align: center;
            color: #666;
            padding: 2rem;
        }
        
        .daily-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        
        .daily-table th,
        .daily-table td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        
        .daily-table th {
            background-color: #f8f9fa;
            font-weight: 600;
        }
        
        .daily-table tr:hover {
            background-color: #f8f9fa;
        }
        
        .status-matched {
            color: #28a745;
        }
        
        .status-discrepancy {
            color: #ffc107;
        }
        
        .status-missing {
            color: #dc3545;
        }
        
        .staff-summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem;
            background: #f8f9fa;
            border-radius: 4px;
            margin-bottom: 0.5rem;
        }
        
        .staff-name {
            font-weight: 600;
        }
        
        .accuracy {
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        .accuracy-high {
            color: #28a745;
        }
        
        .accuracy-medium {
            color: #ffc107;
        }
        
        .accuracy-low {
            color: #dc3545;
        }
        
        .performance-info {
            font-size: 0.8rem;
            color: #666;
            margin-top: 0.5rem;
        }
        
        .clear-cache-btn {
            background-color: #6c757d;
            font-size: 0.8rem;
            padding: 0.25rem 0.75rem;
        }
        
        .clear-cache-btn:hover {
            background-color: #5a6268;
        }
        
        #authMessage {
            background-color: #fff3cd;
            border: 1px solid #ffeeba;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>WFX Timesheet Comparison Dashboard</h1>
        <div style="display: flex; align-items: center;">
            <div class="auth-status" id="authStatusIndicator">Checking auth...</div>
            <div class="stats-indicator" id="statsIndicator">
                🚀 Ready
            </div>
        </div>
    </div>
    
    <div class="container">
        <!-- Authentication Message -->
        <div class="card" id="authMessage" style="display: none;">
            <h2>⚠️ Authentication Required</h2>
            <p>You need to authenticate with WorkflowMax before you can use this dashboard.</p>
            <p>Run <code>npm run auth</code> in your terminal to authenticate.</p>
        </div>
        
        <!-- Controls -->
        <div class="card" id="controlsCard">
            <h2>Run Comparison</h2>
            <div class="controls">
                <div class="form-group">
                    <label for="staffSelect">Staff Member</label>
                    <select id="staffSelect">
                        <option value="">Select staff...</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="startDate">Start Date</label>
                    <input type="date" id="startDate">
                </div>
                <div class="form-group">
                    <label for="endDate">End Date</label>
                    <input type="date" id="endDate">
                </div>
                <button id="compareBtn" onclick="runComparison()">Compare</button>
                <button class="clear-cache-btn" onclick="clearCache()">Clear Cache</button>
            </div>
        </div>
        
        <!-- Overall Summary -->
        <div class="card" id="overallSummary" style="display: none;">
            <h2>Overall Summary</h2>
            <div id="summaryList"></div>
        </div>
        
        <!-- Results -->
        <div class="card" id="results" style="display: none;">
            <h2>Comparison Results</h2>
            <div id="resultsContent"></div>
        </div>
        
        <!-- Daily Details -->
        <div class="card" id="dailyDetails" style="display: none;">
            <h2>Daily Breakdown</h2>
            <div id="dailyContent"></div>
        </div>
    </div>
    
    <script>
        let statsUpdateInterval;
        
        // Initialize
        document.addEventListener('DOMContentLoaded', async () => {
            await checkAuthentication();
            setDefaultDates();
            await loadSummary();
            startStatsUpdater();
        });
        
        function startStatsUpdater() {
            statsUpdateInterval = setInterval(updateStats, 30000); // Update every 30 seconds
            updateStats(); // Initial update
        }
        
        async function updateStats() {
            try {
                const response = await fetch('/api/stats');
                const stats = await response.json();
                const indicator = document.getElementById('statsIndicator');
                indicator.textContent = \`⚡ \${stats.requests} requests | \${Math.round(stats.uptime/60)}m uptime\`;
            } catch (error) {
                console.error('Stats update failed:', error);
            }
        }
        
        async function checkAuthentication() {
            const authStatusIndicator = document.getElementById('authStatusIndicator');
            const authMessageCard = document.getElementById('authMessage');
            const controlsCard = document.getElementById('controlsCard');
            const compareBtn = document.getElementById('compareBtn');
            try {
                const response = await fetch('/api/auth/status');
                const status = await response.json();
                if (status.authenticated) {
                    authStatusIndicator.textContent = '✅ Authenticated with WFX';
                    authStatusIndicator.className = 'auth-status authenticated';
                    authMessageCard.style.display = 'none';
                    controlsCard.style.opacity = 1;
                    compareBtn.disabled = false;
                    loadStaff();
                } else {
                    authStatusIndicator.textContent = '❌ Not Authenticated with WFX';
                    authStatusIndicator.className = 'auth-status not-authenticated';
                    authMessageCard.style.display = 'block';
                    controlsCard.style.opacity = 0.5;
                    compareBtn.disabled = true;
                    document.getElementById('staffSelect').innerHTML = '<option value="">Authenticate first</option>';
                }
            } catch (error) {
                console.error('Failed to check auth status:', error);
                authStatusIndicator.textContent = 'Auth status check failed';
                authStatusIndicator.className = 'auth-status not-authenticated';
                authMessageCard.style.display = 'block';
                authMessageCard.querySelector('p:last-of-type').textContent = 'Error checking authentication status. Ensure the backend server is running and check console.';
                compareBtn.disabled = true;
            }
        }
        
        async function loadStaff() {
            try {
                const response = await fetch('/api/staff');
                const staff = await response.json();
                
                const select = document.getElementById('staffSelect');
                select.innerHTML = '<option value="">Select staff...</option>';
                
                Object.entries(staff).forEach(([id, info]) => {
                    const option = document.createElement('option');
                    option.value = id;
                    option.textContent = info.fullName + ' (' + id + ')';
                    select.appendChild(option);
                });
            } catch (error) {
                console.error('Error loading staff:', error);
            }
        }
        
        function setDefaultDates() {
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            
            document.getElementById('startDate').value = firstDay.toISOString().split('T')[0];
            document.getElementById('endDate').value = lastDay.toISOString().split('T')[0];
        }
        
        async function runComparison() {
            const staffId = document.getElementById('staffSelect').value;
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            
            if (!staffId) {
                alert('Please select a staff member');
                return;
            }
            
            const button = document.getElementById('compareBtn');
            button.disabled = true;
            button.textContent = 'Processing...';
            
            const startTime = Date.now();
            
            try {
                const response = await fetch('/api/compare', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ staffId, startDate, endDate })
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Comparison failed');
                }
                
                const result = await response.json();
                const processingTime = Date.now() - startTime;
                result.clientProcessingTime = processingTime;
                
                displayResults(result);
                await loadSummary();
            } catch (error) {
                alert('Error: ' + error.message);
            } finally {
                button.disabled = false;
                button.textContent = 'Compare';
            }
        }
        
        async function clearCache() {
            try {
                await fetch('/api/cache/clear', { method: 'POST' });
                document.getElementById('overallSummary').style.display = 'none';
                document.getElementById('results').style.display = 'none';
                document.getElementById('dailyDetails').style.display = 'none';
                alert('Cache cleared successfully');
            } catch (error) {
                alert('Error clearing cache: ' + error.message);
            }
        }
        
        async function loadSummary() {
            try {
                const response = await fetch('/api/summary');
                const summary = await response.json();
                
                if (summary.length === 0) return;
                
                document.getElementById('overallSummary').style.display = 'block';
                const summaryList = document.getElementById('summaryList');
                
                summaryList.innerHTML = summary.map(staff => {
                    const accuracyClass = staff.accuracy >= 90 ? 'accuracy-high' : 
                                        staff.accuracy >= 70 ? 'accuracy-medium' : 'accuracy-low';
                    
                    return \`
                        <div class="staff-summary">
                            <div>
                                <div class="staff-name">\${staff.fullName}</div>
                                <div style="color: #666; font-size: 0.9rem;">
                                    \${staff.totalDays} days | \${staff.totalCsvHours.toFixed(1)}h CSV | \${staff.totalWfxHours.toFixed(1)}h WFX
                                </div>
                                <div style="color: #666; font-size: 0.8rem;">
                                    \${staff.totalTrips} trips | \${staff.totalDistance.toFixed(1)}km
                                </div>
                            </div>
                            <div class="accuracy \${accuracyClass}">
                                \${staff.accuracy.toFixed(1)}%
                            </div>
                        </div>
                    \`;
                }).join('');
            } catch (error) {
                console.error('Error loading summary:', error);
            }
        }
        
        function displayResults(result) {
            // Show results section
            document.getElementById('results').style.display = 'block';
            document.getElementById('dailyDetails').style.display = 'block';
            
            // Display summary
            const summary = result.comparison.summary;
            const resultsContent = document.getElementById('resultsContent');
            
            resultsContent.innerHTML = \`
                <div class="summary-grid">
                    <div class="summary-item">
                        <div class="summary-value">\${summary.accuracy}%</div>
                        <div class="summary-label">Accuracy</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">\${summary.totalDays}</div>
                        <div class="summary-label">Days Analyzed</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">\${summary.totalCsvHours.toFixed(1)}h</div>
                        <div class="summary-label">CSV Hours</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">\${summary.totalWfxHours.toFixed(1)}h</div>
                        <div class="summary-label">WFX Hours</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">\${result.csvStats?.totalTrips || 0}</div>
                        <div class="summary-label">Total Trips</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">\${result.csvStats?.totalDistance?.toFixed(1) || 0}km</div>
                        <div class="summary-label">Total Distance</div>
                    </div>
                </div>
                <div class="performance-info">
                    Processing time: \${result.metadata?.processingTimeMs || 0}ms (server) + \${result.clientProcessingTime || 0}ms (client)
                </div>
            \`;
            
            // Display alerts
            if (summary.alerts.length > 0) {
                resultsContent.innerHTML += '<div style="margin-top: 1rem;">';
                summary.alerts.forEach(alert => {
                    const alertClass = alert.severity === 'high' ? 'alert-error' : 
                                     alert.severity === 'medium' ? 'alert-warning' : 'alert-info';
                    resultsContent.innerHTML += \`
                        <div class="alert \${alertClass}">\${alert.message}</div>
                    \`;
                });
                resultsContent.innerHTML += '</div>';
            }
            
            // Display daily details
            const dailyContent = document.getElementById('dailyContent');
            const dailyData = Object.values(result.comparison.dailyComparisons);
            
            dailyContent.innerHTML = \`
                <table class="daily-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>CSV Hours</th>
                            <th>WFX Hours</th>
                            <th>Difference</th>
                            <th>Work Travel</th>
                            <th>Distance</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${dailyData.map(day => \`
                            <tr>
                                <td>\${new Date(day.date).toLocaleDateString()}</td>
                                <td>\${day.csvHours.toFixed(2)}</td>
                                <td>\${day.wfxHours.toFixed(2)}</td>
                                <td>\${day.discrepancy.toFixed(2)}</td>
                                <td>\${day.workTravel} min</td>
                                <td>\${day.totalDistance.toFixed(1)} km</td>
                                <td class="status-\${day.status.replace(' ', '-')}">\${day.status.replace('_', ' ')}</td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;
        }
    </script>
</body>
</html>`;
}

// Export for use in other modules
module.exports = { startServer };

// Start server if run directly
if (require.main === module) {
  startServer().catch(console.error);
} 