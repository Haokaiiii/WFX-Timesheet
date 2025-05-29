// Load environment variables
require('dotenv').config();

// Configuration for WFX API and application settings
const path = require('path');

module.exports = {
  // WorkflowMax API Configuration (Updated for Xero platform)
  wfx: {
    clientId: process.env.WFX_CLIENT_ID,
    clientSecret: process.env.WFX_CLIENT_SECRET,
    accountId: process.env.WFX_ACCOUNT_ID,
    baseUrl: process.env.WFX_BASE_URL || 'https://api.xero.com/workflowmax/3.0',
    authUrl: process.env.WFX_AUTH_URL || 'https://login.xero.com/identity/connect/authorize',
    tokenUrl: process.env.WFX_TOKEN_URL || 'https://identity.xero.com/connect/token',
    callbackUrl: process.env.CALLBACK_URL || 'http://localhost:3001/oauth/callback',
    scopes: process.env.OAUTH_SCOPES || 'openid profile email workflowmax offline_access'
  },
  
  // Debug Configuration
  debug: {
    auth: process.env.DEBUG_AUTH === 'true',
    api: process.env.DEBUG_API === 'true'
  },
  
  // Server Configuration
  server: {
    port: parseInt(process.env.PORT) || 3001
  },
  
  // Staff Configuration - Easy to add new staff
  staff: {
    'Ali_M': {
      fullName: 'Ali Majid',
      homeAddress: '4 Columbine Avenue, Bankstown New South Wales 2200, Australia',
      wfxId: 'wfx_staff_id_ali', // Update with actual WFX staff ID
      defaultHourlyRate: 45.00,
      vehicleId: 'VEH001'
    },
    // Add more staff members here following the same pattern
    // 'FirstName_LastInitial': {
    //   fullName: 'Full Name',
    //   homeAddress: 'Full Address',
    //   wfxId: 'actual_wfx_staff_id',
    //   defaultHourlyRate: 0.00,
    //   vehicleId: 'VEH00X'
    // }
  },
  
  // Directory Configuration
  directories: {
    csvInput: path.join(__dirname, '..', 'csv_files'),
    reports: path.join(__dirname, '..', 'reports'),
    data: path.join(__dirname, '..', 'data'),
    webapp: path.join(__dirname, '..', 'webapp'),
    archive: path.join(__dirname, '..', 'archive')
  },
  
  // Processing Rules
  processing: {
    // Tolerance for matching job locations (in km)
    locationMatchTolerance: 0.5,
    
    // Enhanced job matching settings
    jobMatching: {
      // Minimum confidence score for automatic job matching (0-1)
      minimumMatchConfidence: 0.7,
      // Confidence threshold for fuzzy matching (0-1)
      fuzzyMatchThreshold: 0.4,
      // Maximum time offset for considering jobs as matching (minutes)
      maxTimeOffsetMinutes: 30,
      // Maximum distance for location matching (km)
      maxLocationDistanceKm: 2.0,
      // Weight for location in match scoring (0-1)
      locationWeight: 0.5,
      // Weight for time in match scoring (0-1)
      timeWeight: 0.3,
      // Weight for duration in match scoring (0-1)
      durationWeight: 0.1,
      // Weight for job type in match scoring (0-1)
      jobTypeWeight: 0.1
    },
    
    // Standard working hours
    workingHours: {
      start: '07:00',
      end: '18:00',
      breakAfterHours: 4, // Mandatory break after X hours
      breakDurationMinutes: 30
    },
    
    // Travel time rules
    travelRules: {
      // Maximum allowed travel time between jobs (minutes)
      maxTravelTimeBetweenJobs: 60,
      // Flag if travel time exceeds percentage of work time
      travelTimeWarningThreshold: 0.25, // 25% of work time
      // Personal travel (home to/from work) is not billable
      personalTravelBillable: false
    },
    
    // Reporting preferences
    reporting: {
      // Include detailed trip logs in reports
      includeDetailedTrips: true,
      // Generate visual charts
      generateCharts: true,
      // Email reports automatically
      autoEmailReports: false,
      // Archive processed files
      archiveProcessedFiles: true
    }
  },
  
  // Alert Thresholds
  alerts: {
    // Alert if timesheet hours differ by more than X hours
    timesheetDiscrepancyHours: 0.5,
    // Alert if unaccounted travel time exceeds X minutes
    unaccountedTravelMinutes: 30,
    // Alert if daily distance exceeds X km
    dailyDistanceThreshold: 200,
    // Alert if no timesheet entry found for a workday
    missingTimesheetAlert: true
  },
  
  // Performance Settings
  performance: {
    // Cache WFX API responses for X minutes
    cacheTimeMinutes: 10,
    // Maximum concurrent API requests
    maxConcurrentRequests: 3,
    // Retry failed requests X times
    maxRetries: 3,
    // Request timeout in milliseconds
    requestTimeoutMs: 30000
  }
}; 