# Fixing WorkflowMax OAuth Authentication Error

## Current Issue
You're receiving: `{"error":"invalid_client","error_description":"Client authentication failed"}`

This indicates the OAuth credentials are not being accepted by WorkflowMax.

## Step-by-Step Solution

### 1. Update Ngrok URL (if expired)
Your current ngrok URL might have expired. Start a new ngrok session:

```bash
# In a new terminal:
ngrok http 3001
```

Then update your `.env` file with the new URL:
```env
CALLBACK_URL=https://your-new-ngrok-url.ngrok-free.app/oauth/callback
```

### 2. Verify/Update WorkflowMax OAuth App

1. **Log into WorkflowMax**
   - Go to https://app.workflowmax.com

2. **Navigate to OAuth Settings**
   - Settings → API → OAuth Applications

3. **Check Your OAuth App**
   - Verify the Client ID matches: `9efa49bf-2ee5-40c0-a97e-5a23426b0a0d`
   - Verify the Client Secret matches: `8ESV8OobAlzSVeHo9eKAM6usFFO9FxYx5knHq2fy`
   
   **If they don't match:**
   - Update your `.env` file with the correct values from WorkflowMax

4. **Update Redirect URI**
   - Make sure the Redirect URI in WorkflowMax EXACTLY matches your callback URL
   - It should be: `https://your-ngrok-url.ngrok-free.app/oauth/callback`
   - Or for local testing: `http://localhost:3001/oauth/callback`

5. **Check OAuth Scopes**
   - Ensure these scopes are enabled: `openid`, `profile`, `email`, `workflowmax`

### 3. Create a New OAuth App (if needed)

If the credentials still don't work:

1. **Delete the old OAuth app** in WorkflowMax
2. **Create a new OAuth Application**:
   - Name: WFX Timesheet Comparison
   - Redirect URI: Your callback URL
   - Scopes: Select all available scopes
3. **Copy the new credentials** to your `.env` file:
   ```env
   WFX_CLIENT_ID=new-client-id-from-workflowmax
   WFX_CLIENT_SECRET=new-client-secret-from-workflowmax
   ```

### 4. Test Authentication

After updating credentials:

```bash
# Stop the current server (Ctrl+C)
# Start fresh
npm start

# In another terminal, run the auth test
npm run test-auth
```

### 5. Using the Dashboard

1. Open http://localhost:3001
2. Click "Authenticate with WorkflowMax"
3. Log in to WorkflowMax when prompted
4. Authorize the application
5. You should see "Authentication Successful!"

## Alternative: Local Testing

If ngrok is causing issues, you can test locally:

1. Update `.env`:
   ```env
   CALLBACK_URL=http://localhost:3001/oauth/callback
   ```

2. Update the Redirect URI in WorkflowMax to match

3. Restart the server and test

## Common Issues

### "invalid_client" Error
- **Cause**: Wrong client ID or secret
- **Fix**: Copy credentials exactly from WorkflowMax

### "redirect_uri_mismatch" Error
- **Cause**: Callback URL doesn't match
- **Fix**: Ensure URLs match exactly (including http/https and trailing slashes)

### "invalid_scope" Error
- **Cause**: Requested scopes not available
- **Fix**: Check your WorkflowMax subscription includes API access

## Need More Help?

1. Run diagnostics:
   ```bash
   node src/diagnose-oauth.js
   ```

2. Check WorkflowMax API status:
   - https://status.workflowmax.com

3. Contact WorkflowMax support:
   - Verify your subscription includes API access
   - Ask about OAuth app limits or restrictions 