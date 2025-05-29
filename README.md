# WFX Timesheet Comparison Tool

A powerful tool for comparing GPS trip data from CSV files with WorkflowMax timesheets to ensure accuracy and identify discrepancies.

## Features

- 📊 **Dashboard Interface**: Web-based dashboard for easy comparison and visualization
- 🔐 **OAuth 2.0 Authentication**: Secure integration with WorkflowMax API
- 📈 **Smart Job Matching**: Advanced algorithms to match GPS trips with timesheet entries
- 📍 **Location Validation**: Verify job locations using geocoding
- ⚠️ **Discrepancy Alerts**: Automatic detection of timesheet issues
- 📁 **CSV Processing**: Parse and analyze GPS trip data from CSV files
- 🚀 **Performance Optimized**: Caching and efficient API usage

## Prerequisites

- Node.js 14+ and npm
- WorkflowMax account with API access
- OAuth application credentials from WorkflowMax
- CSV files with GPS trip data

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd WFX-Timesheet
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Create a `.env` file with your WorkflowMax credentials:
   ```env
   # WorkflowMax OAuth credentials
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
   DEBUG_AUTH=true
   DEBUG_API=true
   ```

## Authentication Setup

### Step 1: Create WorkflowMax OAuth App

1. Log into WorkflowMax
2. Navigate to Settings → API → OAuth Applications
3. Create a new application with:
   - Name: WFX Timesheet Comparison
   - Redirect URI: Your callback URL (must match `.env` exactly)
   - Scopes: Select all required scopes

### Step 2: Configure Callback URL

For development, use [ngrok](https://ngrok.com):

```bash
# Start ngrok to tunnel port 3001
ngrok http 3001

# Update .env with the ngrok URL
CALLBACK_URL=https://your-ngrok-url.ngrok-free.app/oauth/callback
```

### Step 3: Authenticate

```bash
# Clear any existing authentication
npm run auth-clear

# Start authentication
npm run auth

# Check authentication status
npm run auth-status
```

The browser will open for WorkflowMax login. After authorization, you'll be redirected to your callback URL.

### Manual Authentication

If automatic authentication doesn't work:

1. Run `node show-auth-url.js` to get the authorization URL
2. Visit the URL in your browser
3. Run `node complete-workflowmax-auth.js` and paste the callback URL

## Usage

### 1. Start the Dashboard

```bash
npm start
# Dashboard opens at http://localhost:3000
```

### 2. Add Staff Configuration

Edit `src/config.js` to add staff members:

```javascript
staff: {
  'FirstName_LastInitial': {
    fullName: 'Full Name',
    homeAddress: 'Full Address',
    wfxId: 'workflowmax-staff-id',
    defaultHourlyRate: 45.00,
    vehicleId: 'VEH001'
  }
}
```

### 3. Add CSV Files

Place GPS trip CSV files in the `csv_files` directory:
- Filename format: `FirstName_LastInitial.csv`
- Must match staff ID in config

### 4. Run Comparisons

1. Open the dashboard
2. Select staff member
3. Choose date range
4. Click "Compare"

## Project Structure

```
WFX-Timesheet/
├── src/                    # Source code
│   ├── auth-workflowmax.js # OAuth authentication
│   ├── config.js          # Configuration
│   ├── dashboard.js       # Web dashboard
│   ├── timesheetComparison.js # Core comparison logic
│   ├── wfxApi.js         # WorkflowMax API client
│   └── ...               # Other modules
├── csv_files/            # Input CSV files
├── data/                 # Token storage
├── reports/              # Generated reports
├── webapp/               # Dashboard UI
└── .env                  # Environment variables
```

## Authentication Scripts

- `npm run auth` - Start authentication process
- `npm run auth-status` - Check authentication status
- `npm run auth-clear` - Clear saved tokens
- `npm run auth-refresh` - Refresh access token

## API Endpoints

The dashboard provides these endpoints:

- `GET /api/staff` - List configured staff
- `POST /api/compare` - Run timesheet comparison
- `GET /api/summary` - Get comparison summaries
- `GET /api/stats` - Performance statistics
- `POST /api/cache/clear` - Clear API cache

## Token Management

- **Access Token**: Expires in 30 minutes (auto-refreshed)
- **Refresh Token**: Expires in 60 days
- Tokens stored in `data/wfx_tokens.json`

## Troubleshooting

### Authentication Issues

1. **"invalid_client" Error**
   - Verify client ID and secret in `.env`
   - Check WorkflowMax OAuth app settings

2. **"redirect_uri_mismatch" Error**
   - Ensure callback URL matches exactly in both `.env` and WorkflowMax
   - Check for http vs https
   - Remove trailing slashes

3. **403 Forbidden**
   - Verify WorkflowMax subscription includes API access
   - Check account permissions
   - Try re-authenticating

### Port Conflicts

If port 3000 is in use:
1. Change `PORT` in `.env`
2. Restart the dashboard

### Debug Mode

Enable debug logging in `.env`:
```env
DEBUG_AUTH=true
DEBUG_API=true
```

## Security Notes

- Never commit `.env` file
- Keep client secret secure
- Use HTTPS for production
- Tokens are stored locally in `data/` directory

## Support

1. Check WorkflowMax API documentation
2. Run diagnostics: `npm run diagnose`
3. Review debug logs with `DEBUG_AUTH=true`

## License

ISC 