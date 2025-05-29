# WFX Timesheet Comparison Tool

A powerful tool to compare vehicle tracking data with WorkflowMax timesheets, helping identify discrepancies and ensure accurate time tracking.

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (.env file)
cp .env.example .env
# Edit .env with your WorkflowMax OAuth credentials

# 3. Authenticate with WorkflowMax
npm run auth

# 4. Start the dashboard
npm start
```

## 📋 Prerequisites

- **Node.js 14+** and npm
- **WorkflowMax account** with API access
- **OAuth credentials** from WorkflowMax (Client ID & Secret)
- **Vehicle tracking CSV files**

## 🛠️ Installation & Setup

### 1. Environment Configuration

Create a `.env` file with your WorkflowMax OAuth credentials:

```env
# WorkflowMax OAuth credentials
WFX_CLIENT_ID=your_client_id_here
WFX_CLIENT_SECRET=your_client_secret_here
WFX_ACCOUNT_ID=your_account_id_here

# Server configuration
PORT=3001
CALLBACK_URL=https://your-ngrok-url.ngrok-free.app/oauth/callback
```

### 2. OAuth Setup in WorkflowMax

1. Log into WorkflowMax
2. Go to **Settings → API → OAuth Applications**
3. Create a new OAuth application with:
   - **Redirect URI**: Your callback URL (ngrok URL or `http://localhost:8080/oauth/callback`)
   - **Scopes**: `openid profile email workflowmax`

### 3. Authentication

The tool automatically detects the best authentication method based on your callback URL:

```bash
# Authenticate (auto-detects best method)
npm run auth

# Check authentication status
npm run auth:status

# Clear saved tokens (if needed)
npm run auth:clear
```

## 📁 Project Structure

```
WFX-Timesheet/
├── src/
│   ├── dashboard.js        # Web dashboard server
│   ├── compare.js          # CLI comparison tool
│   ├── timesheetComparison.js  # Core comparison logic
│   ├── wfxApi.js          # WorkflowMax API client
│   ├── auth.js            # Unified authentication
│   ├── config.js          # Configuration
│   └── cleanup.js         # Maintenance utilities
├── csv_files/             # Vehicle tracking CSV files
├── reports/               # Generated Excel reports
├── webapp/                # Dashboard frontend
├── data/                  # Cached data and tokens
└── .env                   # Environment variables
```

## 🎯 Usage

### Web Dashboard (Recommended)

```bash
npm start
# Open http://localhost:3001 in your browser
```

Features:
- Real-time timesheet comparison
- Visual analytics and charts
- Download Excel reports
- Monitor accuracy trends

### Command Line Interface

```bash
# Compare specific staff member
npm run compare -- -s Ali_M

# Compare all staff
npm run compare:all

# Compare with custom date range
npm run compare -- -s Ali_M -f 2024-01-01 -t 2024-01-31

# List configured staff
node src/compare.js list-staff

# Add new staff member
node src/compare.js add-staff
```

## 📊 CSV File Format

Place CSV files in `csv_files/` directory, named as `StaffID.csv` (e.g., `Ali_M.csv`).

Required columns:
- **Date/Time**: Trip timestamps
- **Duration**: Trip duration
- **From/To**: Location addresses
- **Distance**: Optional but recommended

Example CSV structure:
```csv
Date,Start Time,End Time,From,To,Duration,Distance
2024-01-15,08:30:00,09:15:00,"123 Main St","456 Client Ave",0:45:00,15.2
```

## 🔧 Staff Configuration

Edit `src/config.js` to configure staff members:

```javascript
staff: {
  'John_D': {
    fullName: 'John Doe',
    homeAddress: '123 Main St, City',
    wfxId: 'wfx_staff_id',  // From WorkflowMax
    defaultHourlyRate: 45.00,
    vehicleId: 'VEH001'
  }
}
```

## 📈 Performance Features

- **API Caching**: Reduces API calls by caching responses
- **Token Persistence**: Saves authentication for future sessions
- **Parallel Processing**: Handles multiple staff efficiently
- **Smart Matching**: Intelligent trip-to-timesheet matching

## 🚨 Troubleshooting

### 403 Forbidden Error
```bash
# Clear old tokens and re-authenticate
npm run auth:clear
npm run auth
```

### Authentication Issues
1. Verify OAuth credentials in `.env`
2. Check callback URL matches OAuth app settings
3. Ensure WorkflowMax OAuth app is active

### CSV Processing Errors
- Check date format (YYYY-MM-DD or DD-Mon-YY)
- Verify required columns exist
- Ensure staff ID matches configuration

### Port Already in Use
```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:3001 | xargs kill -9
```

## 🔍 System Check

Run the comprehensive system check:
```bash
npm run quick-start
```

This will:
- Verify all dependencies
- Check environment configuration
- Test WorkflowMax connection
- Validate CSV files
- Provide setup guidance

## 🧹 Maintenance

```bash
# Archive old reports and clean temporary files
npm run cleanup

# View all available commands
npm run
```

## 📊 API Endpoints

When dashboard is running:

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/api/staff` | GET | List all configured staff |
| `/api/compare` | POST | Run comparison for a staff member |
| `/api/results/:staffId` | GET | Get comparison results |
| `/api/summary` | GET | Get summary for all staff |
| `/api/auth/status` | GET | Check authentication status |
| `/api/cache/clear` | POST | Clear API cache |

## 🔒 Security Notes

- Never commit `.env` file to version control
- Keep OAuth credentials secure
- Use HTTPS (ngrok) for production callbacks
- Tokens are encrypted and stored locally

## 📝 License

ISC License

## 💡 Tips

1. **For production use**: Set up a permanent ngrok URL or deploy to a server
2. **Large datasets**: Process in smaller date ranges for better performance
3. **Regular use**: Schedule automated comparisons using cron/Task Scheduler
4. **Accuracy**: Ensure CSV timestamps match actual work times

---

**Need help?** Run `npm run quick-start` for a guided setup or check the logs in your terminal for detailed error messages. 