const csvParser = require('./csvParser');
const WFXApiClient = require('./wfxApi');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');
const chalk = require('chalk');
const EnhancedJobMatcher = require('./enhancedJobMatcher');

class TimesheetComparison {
  constructor() {
    this.wfxClient = new WFXApiClient();
    this.jobMatcher = new EnhancedJobMatcher(this.wfxClient);
    this.comparisonResults = {};
    this.addressCache = new Map(); // Cache for address matching
  }

  /**
   * Determine if address is likely home based on staff config and frequency
   */
  isHomeAddress(address, staffConfig, allTrips) {
    if (!address) return false;
    
    const cacheKey = `${staffConfig.fullName}_${address}`;
    if (this.addressCache.has(cacheKey)) {
      return this.addressCache.get(cacheKey);
    }
    
    const lowerAddress = address.toLowerCase();
    const configHomeWords = staffConfig.homeAddress.toLowerCase().split(/[\s,]+/);
    
    // Check for key identifying words from configured home address
    const isConfiguredHome = configHomeWords.some(word => 
      word.length > 3 && lowerAddress.includes(word)
    );
    
    // If not from config, check if it's the most frequent address
    let isFrequentAddress = false;
    if (!isConfiguredHome && allTrips) {
      const identifiedHome = csvParser.identifyHomeAddress(allTrips);
      isFrequentAddress = identifiedHome === address;
    }
    
    const result = isConfiguredHome || isFrequentAddress;
    this.addressCache.set(cacheKey, result);
    return result;
  }

  /**
   * Main comparison function
   * @param {string} staffId - Staff identifier (e.g., 'Ali_M')
   * @param {string} csvFilePath - Path to CSV file
   * @param {Date} startDate - Start date for comparison
   * @param {Date} endDate - End date for comparison
   */
  async compareTimesheet(staffId, csvFilePath, startDate, endDate) {
    console.log(chalk.blue(`\n📊 Comparing timesheet for ${staffId}...`));
    
    try {
      // Get staff configuration
      const staffConfig = config.staff[staffId];
      if (!staffConfig) {
        throw new Error(`Staff configuration not found for ${staffId}`);
      }

      // Parse CSV data
      console.log(chalk.gray('  • Parsing CSV data...'));
      const startTime = Date.now();
      const csvData = await csvParser.parseCSV(csvFilePath);
      
      // Get CSV statistics
      const csvStats = csvParser.getCSVStats(csvData);
      console.log(chalk.gray(`  • Loaded ${csvStats.totalTrips} trips (${csvStats.totalDistance}km total)`));
      
      const processedData = this.processCsvData(csvData, staffConfig);
      console.log(chalk.gray(`  • Processed in ${Date.now() - startTime}ms`));

      // Get WFX timesheet data with error handling
      console.log(chalk.gray('  • Fetching WFX timesheet data...'));
      let wfxData = {};
      try {
        if (this.wfxClient.isAuthenticated()) {
          wfxData = await this.fetchWfxTimesheet(staffConfig.wfxId, startDate, endDate);
        } else {
          console.log(chalk.yellow('  ⚠️  WFX not authenticated - comparison will show missing entries'));
        }
      } catch (error) {
        console.warn(chalk.yellow(`  ⚠️  WFX fetch failed: ${error.message}`));
      }

      // Compare data
      console.log(chalk.gray('  • Comparing data...'));
      const comparison = await this.performComparison(processedData, wfxData, staffConfig);

      // Store results
      this.comparisonResults[staffId] = {
        staffConfig,
        csvData: processedData,
        wfxData,
        comparison,
        csvStats,
        metadata: {
          csvFile: csvFilePath,
          startDate,
          endDate,
          processedAt: new Date(),
          processingTimeMs: Date.now() - startTime
        }
      };

      // Display summary
      this.displayComparisonSummary(staffId, comparison);

      return comparison;
    } catch (error) {
      console.error(chalk.red(`  ❌ Error comparing timesheet for ${staffId}:`, error.message));
      throw error;
    }
  }

  /**
   * Process CSV data into daily summaries (optimized)
   */
  processCsvData(csvData, staffConfig) {
    const dailySummaries = {};
    
    // Pre-sort trips by date for better performance
    const tripsByDate = csvParser.groupTripsByDate(csvData);
    
    Object.entries(tripsByDate).forEach(([date, trips]) => {
      const summary = {
        date,
        trips: [],
        totalDistance: 0,
        totalDrivingTime: 0,
        workTravelTime: 0,
        personalTravelTime: 0,
        firstArrival: null,
        lastDeparture: null,
        jobSites: new Set()
      };

      trips.forEach((trip, index) => {
        const fromHome = this.isHomeAddress(trip['Address from'], staffConfig, csvData);
        const toHome = this.isHomeAddress(trip['Address to'], staffConfig, csvData);

        // Improved trip classification logic
        if (fromHome && index === 0) {
          trip.classification = 'personal_morning';
        } else if (toHome && index === trips.length - 1) {
          trip.classification = 'personal_evening';
        } else if (fromHome || toHome) {
          trip.classification = 'personal_mixed';
        } else {
          trip.classification = 'work';
        }

        // Update times efficiently
        const startTime = trip['Started, time'];
        const endTime = trip['Finish, time'];
        
        if (!summary.firstArrival || startTime < summary.firstArrival) {
          summary.firstArrival = startTime;
        }
        if (!summary.lastDeparture || endTime > summary.lastDeparture) {
          summary.lastDeparture = endTime;
        }

        // Calculate driving time using optimized parser
        const drivingMinutes = csvParser.timeToMinutes(trip['Driving Time']);
        trip.drivingMinutes = drivingMinutes;

        // Update totals
        summary.totalDistance += trip['Distance'] || 0;
        summary.totalDrivingTime += drivingMinutes;

        if (trip.classification === 'work') {
          summary.workTravelTime += drivingMinutes;
          if (!fromHome && !toHome) {
            summary.jobSites.add(trip['Address to']);
          }
        } else {
          summary.personalTravelTime += drivingMinutes;
        }

        summary.trips.push(trip);
      });

      // Calculate work hours for each day
      if (summary.firstArrival && summary.lastDeparture) {
        const start = this.timeToMinutes(summary.firstArrival);
        const end = this.timeToMinutes(summary.lastDeparture);
        summary.totalWorkMinutes = end - start;
        summary.totalWorkHours = (summary.totalWorkMinutes / 60).toFixed(2);
        
        // Apply break deduction if worked more than threshold
        if (summary.totalWorkHours > config.processing.workingHours.breakAfterHours) {
          summary.breakDeduction = config.processing.workingHours.breakDurationMinutes;
          summary.netWorkMinutes = summary.totalWorkMinutes - summary.breakDeduction;
          summary.netWorkHours = (summary.netWorkMinutes / 60).toFixed(2);
        } else {
          summary.netWorkMinutes = summary.totalWorkMinutes;
          summary.netWorkHours = summary.totalWorkHours;
        }
      }
      
      summary.jobSites = Array.from(summary.jobSites);
      dailySummaries[date] = summary;
    });

    return dailySummaries;
  }

  /**
   * Fetch WFX timesheet data (optimized with caching)
   */
  async fetchWfxTimesheet(wfxStaffId, startDate, endDate) {
    try {
      // Format dates for WFX API
      const fromDate = startDate.toISOString().split('T')[0];
      const toDate = endDate.toISOString().split('T')[0];

      // Get timesheets with caching
      const response = await this.wfxClient.getTimesheets(fromDate, toDate);
      
      // Log the response structure to understand it
      if (config.debug.api) {
        console.log(chalk.gray('  • WFX API Response structure:'));
        console.log(chalk.gray(`    Type: ${typeof response}`));
        console.log(chalk.gray(`    Is Array: ${Array.isArray(response)}`));
        if (response && typeof response === 'object') {
          console.log(chalk.gray(`    Keys: ${Object.keys(response).join(', ')}`));
          // Log the structure to understand XML parsed format
          if (response.Response) {
            console.log(chalk.gray(`    Response keys: ${Object.keys(response.Response).join(', ')}`));
            if (response.Response.TimesheetList) {
              console.log(chalk.gray(`    TimesheetList type: ${typeof response.Response.TimesheetList}`));
              console.log(chalk.gray(`    TimesheetList keys: ${Object.keys(response.Response.TimesheetList).join(', ')}`));
            }
          }
        }
      }
      
      // Handle different response formats
      let timesheets = [];
      if (Array.isArray(response)) {
        timesheets = response;
      } else if (response && response.Timesheets && Array.isArray(response.Timesheets)) {
        // WorkflowMax returns data wrapped in Timesheets property
        timesheets = response.Timesheets;
      } else if (response && response.TimeSheet && Array.isArray(response.TimeSheet)) {
        // Alternative property name
        timesheets = response.TimeSheet;
      } else if (response && response.Response && response.Response.TimesheetList) {
        // Handle parsed XML structure from WorkflowMax
        const timesheetList = response.Response.TimesheetList;
        if (timesheetList.Timesheet) {
          // If single timesheet, make it an array
          timesheets = Array.isArray(timesheetList.Timesheet) 
            ? timesheetList.Timesheet 
            : [timesheetList.Timesheet];
          
          console.log(chalk.gray(`  • Extracted ${timesheets.length} timesheets from XML response`));
          
          // Log first timesheet structure for debugging
          if (config.debug.api && timesheets.length > 0) {
            console.log(chalk.gray(`  • First timesheet structure: ${Object.keys(timesheets[0]).join(', ')}`));
          }
        }
      } else if (response && response.Response && response.Response.Times) {
        // Handle parsed XML structure with Times property
        const timesList = response.Response.Times;
        if (timesList.Time) {
          // If single entry, make it an array
          timesheets = Array.isArray(timesList.Time)
            ? timesList.Time
            : [timesList.Time];

          console.log(chalk.gray(`  • Extracted ${timesheets.length} timesheets from XML response (Times property)`));

          // Log first timesheet structure for debugging
          if (config.debug.api && timesheets.length > 0 && typeof timesheets[0] === 'object' && timesheets[0] !== null) {
            console.log(chalk.gray(`  • First timesheet structure (Times property): ${Object.keys(timesheets[0]).join(', ')}`));
            // Detailed log for the 'Staff' property of the first timesheet
            if (timesheets[0].Staff) {
              console.log(chalk.gray(`    • ts.Staff type: ${typeof timesheets[0].Staff}`));
              if (typeof timesheets[0].Staff === 'object' && timesheets[0].Staff !== null) {
                console.log(chalk.gray(`    • ts.Staff keys: ${Object.keys(timesheets[0].Staff).join(', ')}`));
                try {
                  console.log(chalk.gray(`    • ts.Staff value: ${JSON.stringify(timesheets[0].Staff)}`));
                } catch (e) {
                  console.log(chalk.gray(`    • ts.Staff value: (circular structure or error serializing)`));
                }
              } else {
                console.log(chalk.gray(`    • ts.Staff value: ${timesheets[0].Staff}`));
              }
            } else {
              console.log(chalk.gray(`    • ts.Staff property not found in first timesheet.`));
            }
          } else if (config.debug.api && timesheets.length > 0) {
            console.log(chalk.gray(`  • First timesheet (Times property) is not an object or is null`));
          }
        }
      } else {
        console.warn(chalk.yellow(`  ⚠️  Unexpected WFX API response format. Expected array or object with Timesheets or Times property.`));
        return {};
      }
      
      console.log(chalk.gray(`  • Found ${timesheets.length} total timesheet entries`));
      
      // Filter for specific staff (case-insensitive)
      // WorkflowMax XML uses StaffUUID instead of staffId. The new format seems to use 'Staff', which might be an object or a direct ID.
      const staffTimesheets = timesheets.filter(ts => {
        let staffIdentifier = null;
        
        if (ts.Staff) { // Check the 'Staff' property first, based on new API response structure
          if (typeof ts.Staff === 'object' && ts.Staff !== null) {
            // If 'Staff' is an object, attempt to get UUID or ID from it. Common patterns for Xero API.
            staffIdentifier = ts.Staff.UUID || ts.Staff.ID || ts.Staff.Id || ts.Staff.UserID; 
          } else {
            // If 'Staff' is a primitive (e.g., string ID), use it directly
            staffIdentifier = ts.Staff;
          }
        }

        // Fallback to older known keys if 'Staff' property didn't yield an ID or wasn't present
        if (!staffIdentifier) {
          staffIdentifier = ts.StaffUUID || ts.staffId || ts.StaffID;
        }
        
        return staffIdentifier && staffIdentifier.toString().toLowerCase() === wfxStaffId.toLowerCase();
      });
      
      console.log(chalk.gray(`  • Filtered to ${staffTimesheets.length} entries for staff ${wfxStaffId}`));

      // Group by date efficiently
      const dailyTimesheets = staffTimesheets.reduce((grouped, entry) => {
        // WorkflowMax XML uses Date field
        const date = entry.Date || entry.date;
        if (!date) return grouped;
        
        if (!grouped[date]) {
          grouped[date] = {
            date,
            entries: [],
            totalHours: 0,
            totalMinutes: 0,
            jobs: []
          };
        }

        grouped[date].entries.push(entry);
        
        // Handle both Minutes and TotalMinutes fields
        const minutes = parseFloat(entry.Minutes || entry.TotalMinutes || entry.minutes || 0);
        grouped[date].totalMinutes += minutes;
        grouped[date].totalHours = (grouped[date].totalMinutes / 60).toFixed(2);
        
        // Extract job information if available
        const job = entry.Job || entry.job;
        if (job) {
          grouped[date].jobs.push({
            id: job.ID || job.UUID || job.id,
            name: job.Name || job.name,
            client: job.Client || job.client,
            minutes: minutes
          });
        }

        return grouped;
      }, {});

      // Log the grouped dailyTimesheets before returning
      if (config.debug.api) {
        console.log(chalk.gray('  • Grouped WFX Daily Timesheets (before returning from fetchWfxTimesheet):'));
        try {
          // Attempt to stringify, but be mindful of large objects or circular refs
          const dailyTimesheetsStr = JSON.stringify(dailyTimesheets, null, 2);
          if (dailyTimesheetsStr.length > 2000) { // Limit log length
            console.log(chalk.gray(dailyTimesheetsStr.substring(0, 2000) + '... [truncated]'));
          } else {
            console.log(chalk.gray(dailyTimesheetsStr));
          }
        } catch (e) {
          console.log(chalk.yellow(`  ⚠️  Could not stringify dailyTimesheets for logging: ${e.message}`));
          // Fallback: log keys or a summary
          console.log(chalk.gray(`    Dates with entries: ${Object.keys(dailyTimesheets).join(', ')}`));
          Object.keys(dailyTimesheets).slice(0, 5).forEach(date => { // Log first 5 for brevity
            console.log(chalk.gray(`    ${date}: ${dailyTimesheets[date].totalHours} hours from ${dailyTimesheets[date].entries.length} entries`));
          });
        }
      }

      return dailyTimesheets;
    } catch (error) {
      console.warn(chalk.yellow(`  ⚠️  Could not fetch WFX data: ${error.message}`));
      return {};
    }
  }

  /**
   * Perform detailed comparison (enhanced with job matching)
   */
  async performComparison(csvData, wfxData, staffConfig) {
    const comparison = {
      dailyComparisons: {},
      enhancedComparisons: {}, // New enhanced job-level comparisons
      summary: {
        totalDays: 0,
        matchedDays: 0,
        discrepancyDays: 0,
        missingWfxDays: 0,
        totalCsvHours: 0,
        totalWfxHours: 0,
        totalDiscrepancyHours: 0,
        totalUnaccountedTravel: 0,
        alerts: [],
        // Enhanced metrics
        jobMatchAccuracy: 0,
        locationMatchAccuracy: 0,
        timeMatchAccuracy: 0,
        unmatchedJobs: 0,
        unmatchedTrips: 0
      }
    };

    // Perform traditional comparison first
    this.performTraditionalComparison(comparison, csvData, wfxData);

    // Perform enhanced job-based comparison only if we have WFX data
    const hasWfxData = Object.keys(wfxData).length > 0;
    if (hasWfxData) {
      try {
        console.log(chalk.gray('  • Performing enhanced job matching...'));
        const enhancedResults = await this.jobMatcher.performEnhancedComparison(csvData, wfxData, staffConfig);
        comparison.enhancedComparisons = enhancedResults.dailyComparisons;
        
        // Merge enhanced metrics into summary
        this.mergeEnhancedMetrics(comparison.summary, enhancedResults.summary);
        
        // Generate enhanced alerts
        this.generateEnhancedAlerts(comparison, enhancedResults);
        
        console.log(chalk.gray(`  • Job matching completed: ${enhancedResults.summary.locationMatchAccuracy}% location accuracy`));
      } catch (error) {
        console.warn(chalk.yellow(`  ⚠️  Enhanced job matching failed: ${error.message}`));
        // Fall back to traditional comparison only
      }
    } else {
      console.log(chalk.gray('  • Skipping enhanced job matching (no WFX data available)'));
    }

    return comparison;
  }

  /**
   * Perform traditional day-level comparison (existing logic)
   */
  performTraditionalComparison(comparison, csvData, wfxData) {
    const allDates = Object.keys(csvData);
    comparison.summary.totalDays = allDates.length;

    allDates.forEach(date => {
      const csv = csvData[date];
      const wfx = wfxData[date];
      
      const dayComparison = {
        date,
        csvHours: parseFloat(csv.netWorkHours || 0),
        wfxHours: parseFloat(wfx?.totalHours || 0),
        discrepancy: 0,
        workTravel: csv.workTravelTime,
        personalTravel: csv.personalTravelTime,
        totalDistance: csv.totalDistance,
        status: 'matched',
        alerts: []
      };

      // Calculate discrepancy
      dayComparison.discrepancy = dayComparison.csvHours - dayComparison.wfxHours;
      
      // Update summary efficiently
      comparison.summary.totalCsvHours += dayComparison.csvHours;
      comparison.summary.totalWfxHours += dayComparison.wfxHours;
      comparison.summary.totalDiscrepancyHours += Math.abs(dayComparison.discrepancy);

      // Determine status and alerts
      if (!wfx || wfx.totalHours === 0) {
        dayComparison.status = 'missing_wfx';
        comparison.summary.missingWfxDays++;
        if (config.alerts.missingTimesheetAlert) {
          dayComparison.alerts.push({
            type: 'missing_timesheet',
            message: 'No WFX timesheet entry found for this day'
          });
        }
      } else if (Math.abs(dayComparison.discrepancy) > config.alerts.timesheetDiscrepancyHours) {
        dayComparison.status = 'discrepancy';
        comparison.summary.discrepancyDays++;
        dayComparison.alerts.push({
          type: 'hours_discrepancy',
          message: `Hours differ by ${Math.abs(dayComparison.discrepancy).toFixed(2)} hours`,
          severity: Math.abs(dayComparison.discrepancy) > 2 ? 'high' : 'medium'
        });
      } else {
        comparison.summary.matchedDays++;
      }

      // Check travel time alerts
      if (dayComparison.workTravel > config.alerts.unaccountedTravelMinutes) {
        dayComparison.alerts.push({
          type: 'unaccounted_travel',
          message: `${dayComparison.workTravel} minutes of work travel time`,
          severity: 'medium'
        });
        comparison.summary.totalUnaccountedTravel += dayComparison.workTravel;
      }

      // Check distance alerts
      if (dayComparison.totalDistance > config.alerts.dailyDistanceThreshold) {
        dayComparison.alerts.push({
          type: 'high_distance',
          message: `Daily distance of ${dayComparison.totalDistance.toFixed(1)}km exceeds threshold`,
          severity: 'low'
        });
      }

      comparison.dailyComparisons[date] = dayComparison;
    });

    // Calculate accuracy percentage
    comparison.summary.accuracy = comparison.summary.totalDays > 0 
      ? ((comparison.summary.matchedDays / comparison.summary.totalDays) * 100).toFixed(1)
      : 0;
  }

  /**
   * Merge enhanced job matching metrics into summary
   */
  mergeEnhancedMetrics(summary, enhancedSummary) {
    summary.jobMatchAccuracy = parseFloat(enhancedSummary.locationMatchAccuracy);
    summary.locationMatchAccuracy = parseFloat(enhancedSummary.locationMatchAccuracy);
    summary.timeMatchAccuracy = parseFloat(enhancedSummary.timeMatchAccuracy);
    summary.unmatchedJobs = enhancedSummary.unmatchedWfxEntries;
    summary.unmatchedTrips = enhancedSummary.unmatchedTrips;
  }

  /**
   * Generate enhanced alerts based on job matching results
   */
  generateEnhancedAlerts(comparison, enhancedResults) {
    // Location matching alerts
    if (enhancedResults.summary.locationMatchAccuracy < 70) {
      comparison.summary.alerts.push({
        type: 'low_location_accuracy',
        message: `Poor location matching (${enhancedResults.summary.locationMatchAccuracy}%) - jobs may not be correctly matched to trip destinations`,
        severity: 'high'
      });
    }

    // Time matching alerts  
    if (enhancedResults.summary.timeMatchAccuracy < 60) {
      comparison.summary.alerts.push({
        type: 'low_time_accuracy',
        message: `Poor time matching (${enhancedResults.summary.timeMatchAccuracy}%) - job times may not align with trip times`,
        severity: 'medium'
      });
    }

    // Unmatched work alerts
    if (enhancedResults.summary.unmatchedTrips > 0) {
      comparison.summary.alerts.push({
        type: 'unmatched_work_trips',
        message: `${enhancedResults.summary.unmatchedTrips} work trips could not be matched to WFX jobs`,
        severity: 'medium'
      });
    }

    if (enhancedResults.summary.unmatchedWfxEntries > 0) {
      comparison.summary.alerts.push({
        type: 'unmatched_wfx_jobs',
        message: `${enhancedResults.summary.unmatchedWfxEntries} WFX job entries have no corresponding trips`,
        severity: 'medium'
      });
    }

    // Daily-level alerts from enhanced comparison
    Object.values(enhancedResults.dailyComparisons).forEach(day => {
      if (day.timeDiscrepancies.length > 0) {
        const highSeverity = day.timeDiscrepancies.filter(d => d.severity === 'high');
        if (highSeverity.length > 0) {
          comparison.summary.alerts.push({
            type: 'significant_time_discrepancy',
            message: `${day.date}: ${highSeverity.length} jobs have significant time discrepancies (>1 hour)`,
            severity: 'high'
          });
        }
      }

      if (day.locationIssues.length > 0) {
        const highSeverity = day.locationIssues.filter(l => l.severity === 'high');
        if (highSeverity.length > 0) {
          comparison.summary.alerts.push({
            type: 'significant_location_discrepancy',
            message: `${day.date}: ${highSeverity.length} jobs have significant location discrepancies (>2km)`,
            severity: 'high'
          });
        }
      }
    });
  }

  /**
   * Display enhanced comparison summary in console
   */
  displayComparisonSummary(staffId, comparison) {
    const summary = comparison.summary;
    const result = this.comparisonResults[staffId];
    
    console.log(chalk.bold(`\n📊 Enhanced Comparison Summary for ${config.staff[staffId].fullName}:`));
    console.log(chalk.gray('─'.repeat(60)));
    
    // Display processing stats
    if (result?.csvStats) {
      console.log(`  Data Range: ${result.csvStats.dateRange?.start} to ${result.csvStats.dateRange?.end}`);
      console.log(`  Total Trips: ${result.csvStats.totalTrips} | Unique Days: ${result.csvStats.uniqueDates}`);
    }
    
    console.log(`  Days Analyzed: ${summary.totalDays}`);
    
    // Traditional accuracy
    const accuracyColor = summary.accuracy >= 90 ? chalk.green : 
                         summary.accuracy >= 70 ? chalk.yellow : chalk.red;
    console.log(`  Day-level Accuracy: ${accuracyColor(summary.accuracy + '%')} (${summary.matchedDays} matched days)`);
    
    // Enhanced job-level metrics
    if (summary.locationMatchAccuracy > 0) {
      const locationColor = summary.locationMatchAccuracy >= 80 ? chalk.green : 
                           summary.locationMatchAccuracy >= 60 ? chalk.yellow : chalk.red;
      console.log(`  Job Location Accuracy: ${locationColor(summary.locationMatchAccuracy + '%')}`);
      
      const timeColor = summary.timeMatchAccuracy >= 70 ? chalk.green : 
                       summary.timeMatchAccuracy >= 50 ? chalk.yellow : chalk.red;
      console.log(`  Time Matching Accuracy: ${timeColor(summary.timeMatchAccuracy + '%')}`);
      
      if (summary.unmatchedTrips > 0) {
        console.log(chalk.yellow(`  ⚠️  Unmatched Work Trips: ${summary.unmatchedTrips}`));
      }
      
      if (summary.unmatchedJobs > 0) {
        console.log(chalk.yellow(`  ⚠️  Unmatched WFX Jobs: ${summary.unmatchedJobs}`));
      }
    }
    
    if (summary.discrepancyDays > 0) {
      console.log(chalk.yellow(`  ⚠️  Discrepancy Days: ${summary.discrepancyDays}`));
    }
    
    if (summary.missingWfxDays > 0) {
      console.log(chalk.red(`  ❌ Missing WFX Entries: ${summary.missingWfxDays} days`));
    }
    
    console.log(`\n  Hours Comparison:`);
    console.log(`    CSV Total: ${summary.totalCsvHours.toFixed(2)} hours`);
    console.log(`    WFX Total: ${summary.totalWfxHours.toFixed(2)} hours`);
    
    const hoursDiff = summary.totalCsvHours - summary.totalWfxHours;
    const diffColor = Math.abs(hoursDiff) > 2 ? chalk.red : chalk.gray;
    console.log(`    Difference: ${diffColor(hoursDiff.toFixed(2) + ' hours')}`);
    
    if (summary.totalUnaccountedTravel > 0) {
      console.log(chalk.yellow(`\n  ⚠️  Unaccounted Travel: ${(summary.totalUnaccountedTravel / 60).toFixed(2)} hours`));
    }
    
    if (summary.alerts.length > 0) {
      console.log(chalk.bold('\n  ⚡ Summary Alerts:'));
      summary.alerts.forEach(alert => {
        const color = alert.severity === 'high' ? chalk.red : 
                     alert.severity === 'medium' ? chalk.yellow : chalk.gray;
        console.log(color(`    • ${alert.message}`));
      });
    }
    
    // Performance info
    if (result?.metadata?.processingTimeMs) {
      console.log(chalk.gray(`\n  ⚡ Processed in ${result.metadata.processingTimeMs}ms`));
    }
    
    console.log(chalk.gray('─'.repeat(60)));
  }

  /**
   * Generate Excel report (optimized)
   */
  async generateExcelReport(outputPath) {
    const workbook = new ExcelJS.Workbook();
    
    // Set workbook properties for better performance
    workbook.creator = 'WFX Timesheet Comparison Tool';
    workbook.lastModifiedBy = 'WFX Timesheet Comparison Tool';
    workbook.created = new Date();
    
    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    this.createSummarySheet(summarySheet);
    
    // Individual staff sheets
    Object.keys(this.comparisonResults).forEach(staffId => {
      const result = this.comparisonResults[staffId];
      const sheet = workbook.addWorksheet(result.staffConfig.fullName);
      this.createStaffSheet(sheet, staffId, result);
    });
    
    await workbook.xlsx.writeFile(outputPath);
    console.log(chalk.green(`✅ Excel report saved to: ${outputPath}`));
  }

  /**
   * Helper functions (optimized)
   */
  parseDrivingTime(timeString) {
    return csvParser.timeToMinutes(timeString);
  }

  timeToMinutes(timeString) {
    if (!timeString) return 0;
    const [hours, minutes] = timeString.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  }

  /**
   * Clear caches to free memory
   */
  clearCaches() {
    this.addressCache.clear();
    this.wfxClient.clearCache();
    console.log('🗑️ Cleared all caches');
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return {
      addressCacheSize: this.addressCache.size,
      wfxCacheStats: this.wfxClient.getCacheStats(),
      resultsCount: Object.keys(this.comparisonResults).length
    };
  }

  createSummarySheet(sheet) {
    // Add headers with improved styling
    sheet.columns = [
      { header: 'Staff Name', key: 'name', width: 20 },
      { header: 'Days Analyzed', key: 'days', width: 15 },
      { header: 'Accuracy %', key: 'accuracy', width: 12 },
      { header: 'CSV Hours', key: 'csvHours', width: 12 },
      { header: 'WFX Hours', key: 'wfxHours', width: 12 },
      { header: 'Difference', key: 'difference', width: 12 },
      { header: 'Unaccounted Travel', key: 'travel', width: 18 },
      { header: 'Total Distance', key: 'distance', width: 15 },
      { header: 'Alerts', key: 'alerts', width: 30 }
    ];

    // Style headers
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };

    // Add data with conditional formatting
    Object.entries(this.comparisonResults).forEach(([staffId, result]) => {
      const summary = result.comparison.summary;
      const csvStats = result.csvStats || {};
      
      const row = sheet.addRow({
        name: result.staffConfig.fullName,
        days: summary.totalDays,
        accuracy: `${summary.accuracy}%`,
        csvHours: summary.totalCsvHours.toFixed(2),
        wfxHours: summary.totalWfxHours.toFixed(2),
        difference: (summary.totalCsvHours - summary.totalWfxHours).toFixed(2),
        travel: `${(summary.totalUnaccountedTravel / 60).toFixed(2)} hours`,
        distance: `${csvStats.totalDistance?.toFixed(1) || 0} km`,
        alerts: summary.alerts.map(a => a.message).join('; ')
      });

      // Apply conditional formatting based on accuracy
      const accuracy = parseFloat(summary.accuracy);
      if (accuracy < 70) {
        row.getCell('accuracy').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
      } else if (accuracy < 90) {
        row.getCell('accuracy').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
      } else {
        row.getCell('accuracy').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
      }
    });
  }

  createStaffSheet(sheet, staffId, result) {
    // Add headers
    sheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'CSV Hours', key: 'csvHours', width: 12 },
      { header: 'WFX Hours', key: 'wfxHours', width: 12 },
      { header: 'Difference', key: 'difference', width: 12 },
      { header: 'Work Travel', key: 'workTravel', width: 15 },
      { header: 'Personal Travel', key: 'personalTravel', width: 15 },
      { header: 'Total Distance', key: 'distance', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Alerts', key: 'alerts', width: 40 }
    ];

    // Style headers
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };

    // Add data with conditional formatting
    Object.values(result.comparison.dailyComparisons).forEach(day => {
      const row = sheet.addRow({
        date: day.date,
        csvHours: day.csvHours.toFixed(2),
        wfxHours: day.wfxHours.toFixed(2),
        difference: day.discrepancy.toFixed(2),
        workTravel: `${day.workTravel} min`,
        personalTravel: `${day.personalTravel} min`,
        distance: `${day.totalDistance.toFixed(1)} km`,
        status: day.status.replace('_', ' '),
        alerts: day.alerts.map(a => a.message).join('; ')
      });

      // Apply conditional formatting
      if (day.status === 'discrepancy') {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFEB9C' }
        };
      } else if (day.status === 'missing_wfx') {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC7CE' }
        };
      }
    });

    // Add summary row
    const summaryRow = sheet.addRow({
      date: 'TOTAL',
      csvHours: result.comparison.summary.totalCsvHours.toFixed(2),
      wfxHours: result.comparison.summary.totalWfxHours.toFixed(2),
      difference: (result.comparison.summary.totalCsvHours - result.comparison.summary.totalWfxHours).toFixed(2),
      workTravel: `${(result.comparison.summary.totalUnaccountedTravel).toFixed(0)} min`,
      personalTravel: '',
      distance: `${result.csvStats?.totalDistance?.toFixed(1) || 0} km`,
      status: `${result.comparison.summary.accuracy}% accuracy`,
      alerts: ''
    });

    summaryRow.font = { bold: true };
    summaryRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };
  }
}

module.exports = TimesheetComparison; 