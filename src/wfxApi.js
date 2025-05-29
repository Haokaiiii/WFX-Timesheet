const axios = require('axios');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');

class WFXApiClient {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.cache = new Map();
    this.tokenPath = path.join(config.directories.data, 'wfx_tokens.json');
    
    // Initialize with saved tokens if available
    this.loadSavedTokens().catch(() => {
      // Ignore errors if no saved tokens exist
    });
  }

  /**
   * Load saved tokens from file
   */
  async loadSavedTokens() {
    try {
      const tokenData = await fs.readFile(this.tokenPath, 'utf8');
      const tokens = JSON.parse(tokenData);
      
      if (tokens.accessToken && tokens.tokenExpiry > Date.now()) {
        this.accessToken = tokens.accessToken;
        this.refreshToken = tokens.refreshToken;
        this.tokenExpiry = tokens.tokenExpiry;
        console.log('📱 Loaded saved WFX tokens');
      } else {
        // Tokens expired, clear them
        await this.clearTokens();
      }
    } catch (error) {
      // No saved tokens or invalid format
    }
  }

  /**
   * Clear saved tokens
   */
  async clearTokens() {
    try {
      await fs.unlink(this.tokenPath);
      this.accessToken = null;
      this.refreshToken = null;
      this.tokenExpiry = null;
    } catch {
      // File might not exist
    }
  }

  /**
   * Save tokens to file
   */
  async saveTokens() {
    try {
      await fs.mkdir(config.directories.data, { recursive: true });
      const tokenData = {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        tokenExpiry: this.tokenExpiry,
        savedAt: new Date().toISOString()
      };
      await fs.writeFile(this.tokenPath, JSON.stringify(tokenData, null, 2));
    } catch (error) {
      console.warn('⚠️ Could not save tokens:', error.message);
    }
  }

  /**
   * Get cache key for API request
   */
  getCacheKey(endpoint, params = {}) {
    return `${endpoint}_${JSON.stringify(params)}`;
  }

  /**
   * Check if cached response is still valid
   */
  isCacheValid(cacheEntry) {
    const ageMinutes = (Date.now() - cacheEntry.timestamp) / (1000 * 60);
    return ageMinutes < config.performance.cacheTimeMinutes;
  }

  /**
   * Generate OAuth authorization URL
   * @param {string} customCallbackUrl - Optional custom callback URL
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(customCallbackUrl = null) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.wfx.clientId,
      redirect_uri: customCallbackUrl || config.wfx.callbackUrl,
      scope: 'openid profile email workflowmax',
      state: Math.random().toString(36).substring(7)
    });

    return `${config.wfx.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code
   * @param {string} customCallbackUrl - Optional custom callback URL
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForToken(code, customCallbackUrl = null) {
    try {
      // Use application/x-www-form-urlencoded for OAuth token requests
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.wfx.clientId,
        client_secret: config.wfx.clientSecret,
        code: code,
        redirect_uri: customCallbackUrl || config.wfx.callbackUrl
      });

      const response = await axios.post(config.wfx.tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      this.accessToken = response.data.access_token;
      this.refreshToken = response.data.refresh_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

      await this.saveTokens();
      return response.data;
    } catch (error) {
      console.error('Error exchanging code for token:', error.response?.data || error.message);
      
      // Log detailed error for debugging
      if (error.response?.data) {
        console.error('OAuth Error Details:', JSON.stringify(error.response.data, null, 2));
      }
      
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   * @returns {Promise<Object>} Token response
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      // Use application/x-www-form-urlencoded for OAuth token requests
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.wfx.clientId,
        client_secret: config.wfx.clientSecret,
        refresh_token: this.refreshToken
      });

      const response = await axios.post(config.wfx.tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      this.accessToken = response.data.access_token;
      this.refreshToken = response.data.refresh_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

      await this.saveTokens();
      return response.data;
    } catch (error) {
      console.error('Error refreshing token:', error.response?.data || error.message);
      
      // Log detailed error for debugging
      if (error.response?.data) {
        console.error('OAuth Error Details:', JSON.stringify(error.response.data, null, 2));
      }
      
      throw error;
    }
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  async ensureValidToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry - 60000) {
      if (this.refreshToken) {
        await this.refreshAccessToken();
      } else {
        throw new Error('No valid authentication token. Please run "npm run auth" to authenticate.');
      }
    }
  }

  /**
   * Make HTTP request with retry logic
   */
  async makeRequest(method, url, data = null, useAuth = true, retryCount = 0) {
    const requestConfig = {
      method,
      url,
      timeout: config.performance?.requestTimeoutMs || 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    if (useAuth) {
      requestConfig.headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (method === 'GET' && data) {
      requestConfig.params = data;
    } else if (data) {
      requestConfig.data = data;
    }

    try {
      return await axios(requestConfig);
    } catch (error) {
      // Retry logic for network errors
      if (retryCount < (config.performance?.maxRetries || 3) && 
          (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || 
           error.response?.status >= 500)) {
        
        console.warn(`⚠️ Request failed, retrying (${retryCount + 1}/${config.performance?.maxRetries || 3})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
        return this.makeRequest(method, url, data, useAuth, retryCount + 1);
      }
      
      throw error;
    }
  }

  /**
   * Make authenticated API request with caching
   * @param {string} endpoint - API endpoint
   * @param {string} method - HTTP method
   * @param {Object} data - Request data
   * @param {boolean} useCache - Whether to use caching
   * @returns {Promise<Object>} API response
   */
  async apiRequest(endpoint, method = 'GET', data = null, useCache = true) {
    await this.ensureValidToken();

    // Check cache for GET requests
    if (method === 'GET' && useCache) {
      const cacheKey = this.getCacheKey(endpoint, data);
      const cached = this.cache.get(cacheKey);
      
      if (cached && this.isCacheValid(cached)) {
        console.log(`📋 Using cached data for ${endpoint}`);
        return cached.data;
      }
    }

    const url = `${config.wfx.baseUrl}${endpoint}`;

    try {
      const response = await this.makeRequest(method, url, data, true);
      
      // Cache GET responses
      if (method === 'GET' && useCache) {
        const cacheKey = this.getCacheKey(endpoint, data);
        this.cache.set(cacheKey, {
          data: response.data,
          timestamp: Date.now()
        });
      }

      return response.data;
    } catch (error) {
      // Handle 403 errors by clearing invalid tokens
      if (error.response?.status === 403) {
        await this.clearTokens();
        console.error('🔒 Authentication failed (403). Please re-authenticate with: npm run auth');
      }
      
      console.error('API request error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get all jobs for a date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of jobs
   */
  async getJobs(startDate, endDate) {
    return this.apiRequest('/api/2.0/jobs', 'GET', {
      from: startDate,
      to: endDate,
      detailed: true
    });
  }

  /**
   * Get timesheets for a date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of timesheets
   */
  async getTimesheets(startDate, endDate) {
    return this.apiRequest('/api/2.0/time', 'GET', {
      from: startDate,
      to: endDate,
      detailed: true
    });
  }

  /**
   * Get staff members
   * @returns {Promise<Array>} Array of staff
   */
  async getStaff() {
    return this.apiRequest('/api/2.0/staff', 'GET');
  }

  /**
   * Get specific staff member details
   * @param {string} staffId - Staff ID
   * @returns {Promise<Object>} Staff details
   */
  async getStaffMember(staffId) {
    return this.apiRequest(`/api/2.0/staff/${staffId}`, 'GET');
  }

  /**
   * Get specific job details
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Job details
   */
  async getJob(jobId) {
    return this.apiRequest(`/api/2.0/jobs/${jobId}`, 'GET');
  }

  /**
   * Create timesheet entry
   * @param {Object} timesheetData - Timesheet data
   * @returns {Promise<Object>} Created timesheet
   */
  async createTimesheet(timesheetData) {
    return this.apiRequest('/api/2.0/time', 'POST', timesheetData, false);
  }

  /**
   * Update timesheet entry
   * @param {string} timesheetId - Timesheet ID
   * @param {Object} timesheetData - Updated timesheet data
   * @returns {Promise<Object>} Updated timesheet
   */
  async updateTimesheet(timesheetId, timesheetData) {
    return this.apiRequest(`/api/2.0/time/${timesheetId}`, 'PUT', timesheetData, false);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }

  /**
   * Set tokens manually (for saved sessions)
   * @param {Object} tokenData - Token data
   */
  setTokens(tokenData) {
    this.accessToken = tokenData.accessToken;
    this.refreshToken = tokenData.refreshToken;
    this.tokenExpiry = tokenData.tokenExpiry;
  }

  /**
   * Get current tokens (for saving sessions)
   * @returns {Object} Current token data
   */
  getTokens() {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      tokenExpiry: this.tokenExpiry
    };
  }

  /**
   * Check if client is authenticated
   */
  isAuthenticated() {
    return this.accessToken && this.tokenExpiry > Date.now();
  }
}

module.exports = WFXApiClient; 