const config = require('./config');

class EnhancedJobMatcher {
  constructor(wfxClient) {
    this.wfxClient = wfxClient;
    this.addressCache = new Map();
    this.geocodeCache = new Map();
  }

  /**
   * Enhanced comparison that matches specific jobs with CSV trips
   * @param {Object} csvData - Daily CSV data
   * @param {Object} wfxData - Daily WFX data
   * @param {Object} staffConfig - Staff configuration
   * @returns {Object} Enhanced comparison with job-level matching
   */
  async performEnhancedComparison(csvData, wfxData, staffConfig) {
    const enhancedComparison = {
      dailyComparisons: {},
      summary: {
        totalDays: 0,
        matchedJobs: 0,
        unmatchedTrips: 0,
        unmatchedWfxEntries: 0,
        locationMatchAccuracy: 0,
        timeMatchAccuracy: 0,
        alerts: []
      }
    };

    // Process each day with enhanced job matching
    for (const [date, csv] of Object.entries(csvData)) {
      const wfx = wfxData[date];
      const dayComparison = await this.matchJobsForDay(date, csv, wfx, staffConfig);
      enhancedComparison.dailyComparisons[date] = dayComparison;
      
      // Update summary statistics
      this.updateSummaryStats(enhancedComparison.summary, dayComparison);
    }

    enhancedComparison.summary.totalDays = Object.keys(csvData).length;
    this.calculateAccuracyMetrics(enhancedComparison.summary);

    return enhancedComparison;
  }

  /**
   * Match jobs for a specific day using location and time analysis
   * @param {string} date - Date to analyze
   * @param {Object} csvDay - CSV trips for the day
   * @param {Object} wfxDay - WFX entries for the day
   * @param {Object} staffConfig - Staff configuration
   * @returns {Object} Day comparison with job matches
   */
  async matchJobsForDay(date, csvDay, wfxDay, staffConfig) {
    const dayComparison = {
      date,
      jobMatches: [],
      unmatchedTrips: [],
      unmatchedWfxEntries: [],
      timeDiscrepancies: [],
      locationIssues: [],
      summary: {
        totalCsvHours: parseFloat(csvDay.netWorkHours || 0),
        totalWfxHours: parseFloat(wfxDay?.totalHours || 0),
        matchedHours: 0,
        locationMatchRate: 0,
        timeMatchRate: 0
      }
    };

    if (!wfxDay || !wfxDay.entries || wfxDay.entries.length === 0) {
      // No WFX data for this day
      dayComparison.unmatchedTrips = csvDay.trips.filter(trip => trip.classification === 'work');
      return dayComparison;
    }

    // Get job details for WFX entries
    const jobDetails = await this.fetchJobDetails(wfxDay.entries);
    
    // Create time-sorted work trips
    const workTrips = csvDay.trips
      .filter(trip => trip.classification === 'work')
      .sort((a, b) => a['Started, time'].localeCompare(b['Started, time']));

    // Create time-sorted WFX entries with job details
    const wfxEntriesWithJobs = wfxDay.entries
      .map(entry => ({
        ...entry,
        jobDetails: jobDetails[entry.jobId] || null
      }))
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    // Perform sophisticated matching
    const matches = await this.performJobMatching(workTrips, wfxEntriesWithJobs, staffConfig);
    
    // Analyze matches and create detailed comparison
    dayComparison.jobMatches = matches.matched;
    dayComparison.unmatchedTrips = matches.unmatchedTrips;
    dayComparison.unmatchedWfxEntries = matches.unmatchedWfxEntries;
    dayComparison.timeDiscrepancies = matches.timeDiscrepancies;
    dayComparison.locationIssues = matches.locationIssues;

    // Calculate summary metrics
    this.calculateDaySummary(dayComparison);

    return dayComparison;
  }

  /**
   * Perform sophisticated job matching using multiple criteria
   * @param {Array} trips - Work trips from CSV
   * @param {Array} wfxEntries - WFX timesheet entries with job details
   * @param {Object} staffConfig - Staff configuration
   * @returns {Object} Matching results
   */
  async performJobMatching(trips, wfxEntries, staffConfig) {
    const results = {
      matched: [],
      unmatchedTrips: [...trips],
      unmatchedWfxEntries: [...wfxEntries],
      timeDiscrepancies: [],
      locationIssues: []
    };

    // First pass: Direct location and time matching
    for (let i = trips.length - 1; i >= 0; i--) {
      const trip = trips[i];
      const bestMatch = await this.findBestJobMatch(trip, wfxEntries, staffConfig);
      
      if (bestMatch && bestMatch.confidence > config.processing.jobMatching.minimumMatchConfidence) {
        const matchInfo = {
          trip,
          wfxEntry: bestMatch.wfxEntry,
          confidence: bestMatch.confidence,
          matchCriteria: bestMatch.criteria,
          locationMatch: bestMatch.locationMatch,
          timeMatch: bestMatch.timeMatch,
          distanceKm: bestMatch.distanceKm,
          timeOffsetMinutes: bestMatch.timeOffsetMinutes
        };

        results.matched.push(matchInfo);
        results.unmatchedTrips.splice(i, 1);
        
        const wfxIndex = results.unmatchedWfxEntries.findIndex(e => e.id === bestMatch.wfxEntry.id);
        if (wfxIndex !== -1) {
          results.unmatchedWfxEntries.splice(wfxIndex, 1);
        }

        // Check for discrepancies
        if (bestMatch.timeOffsetMinutes > config.processing.jobMatching.maxTimeOffsetMinutes) {
          results.timeDiscrepancies.push({
            trip,
            wfxEntry: bestMatch.wfxEntry,
            offsetMinutes: bestMatch.timeOffsetMinutes,
            severity: bestMatch.timeOffsetMinutes > 60 ? 'high' : 'medium'
          });
        }

        if (bestMatch.distanceKm > config.processing.jobMatching.maxLocationDistanceKm) {
          results.locationIssues.push({
            trip,
            wfxEntry: bestMatch.wfxEntry,
            distanceKm: bestMatch.distanceKm,
            severity: bestMatch.distanceKm > config.processing.jobMatching.maxLocationDistanceKm * 2 ? 'high' : 'medium'
          });
        }
      }
    }

    // Second pass: Fuzzy matching for remaining entries
    await this.performFuzzyMatching(results, staffConfig);

    return results;
  }

  /**
   * Find the best matching WFX job for a given trip
   * @param {Object} trip - CSV trip data
   * @param {Array} wfxEntries - Available WFX entries
   * @param {Object} staffConfig - Staff configuration
   * @returns {Object} Best match with confidence score
   */
  async findBestJobMatch(trip, wfxEntries, staffConfig) {
    let bestMatch = null;
    let highestConfidence = 0;

    for (const wfxEntry of wfxEntries) {
      if (!wfxEntry.jobDetails) continue;

      const matchScore = await this.calculateMatchScore(trip, wfxEntry, staffConfig);
      
      if (matchScore.confidence > highestConfidence) {
        highestConfidence = matchScore.confidence;
        bestMatch = {
          wfxEntry,
          confidence: matchScore.confidence,
          criteria: matchScore.criteria,
          locationMatch: matchScore.locationMatch,
          timeMatch: matchScore.timeMatch,
          distanceKm: matchScore.distanceKm,
          timeOffsetMinutes: matchScore.timeOffsetMinutes
        };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate comprehensive match score between trip and WFX entry
   * @param {Object} trip - CSV trip
   * @param {Object} wfxEntry - WFX entry with job details
   * @param {Object} staffConfig - Staff configuration
   * @returns {Object} Match score details
   */
  async calculateMatchScore(trip, wfxEntry, staffConfig) {
    const score = {
      confidence: 0,
      criteria: [],
      locationMatch: 0,
      timeMatch: 0,
      distanceKm: null,
      timeOffsetMinutes: null
    };

    // Location matching
    const locationScore = await this.calculateLocationMatch(
      trip['Address to'], 
      wfxEntry.jobDetails.address
    );
    score.locationMatch = locationScore.score;
    score.distanceKm = locationScore.distanceKm;

    if (locationScore.score > 0.8) {
      score.confidence += config.processing.jobMatching.locationWeight; // Use config weight for location
      score.criteria.push('exact_location');
    } else if (locationScore.score > 0.6) {
      score.confidence += config.processing.jobMatching.locationWeight * 0.6; // Reduced weight for approximate match
      score.criteria.push('approximate_location');
    }

    // Time matching
    const timeScore = this.calculateTimeMatch(trip, wfxEntry);
    score.timeMatch = timeScore.score;
    score.timeOffsetMinutes = timeScore.offsetMinutes;

    if (timeScore.score > 0.8) {
      score.confidence += config.processing.jobMatching.timeWeight; // Use config weight for time
      score.criteria.push('time_overlap');
    } else if (timeScore.score > 0.5) {
      score.confidence += config.processing.jobMatching.timeWeight * 0.5; // Reduced weight for approximate match
      score.criteria.push('approximate_time');
    }

    // Duration consistency
    const durationScore = this.calculateDurationMatch(trip, wfxEntry);
    if (durationScore > 0.7) {
      score.confidence += config.processing.jobMatching.durationWeight;
      score.criteria.push('duration_match');
    }

    // Job type consistency (if available)
    const jobTypeScore = this.calculateJobTypeMatch(trip, wfxEntry);
    if (jobTypeScore > 0.5) {
      score.confidence += config.processing.jobMatching.jobTypeWeight;
      score.criteria.push('job_type_match');
    }

    return score;
  }

  /**
   * Calculate location match score using address comparison
   * @param {string} tripAddress - Trip destination address
   * @param {string} jobAddress - Job location address
   * @returns {Object} Location match score and distance
   */
  async calculateLocationMatch(tripAddress, jobAddress) {
    if (!tripAddress || !jobAddress) {
      return { score: 0, distanceKm: null };
    }

    // Normalize addresses for comparison
    const normalizedTrip = this.normalizeAddress(tripAddress);
    const normalizedJob = this.normalizeAddress(jobAddress);

    // Exact match
    if (normalizedTrip === normalizedJob) {
      return { score: 1.0, distanceKm: 0 };
    }

    // Check for partial matches
    const partialScore = this.calculatePartialAddressMatch(normalizedTrip, normalizedJob);
    if (partialScore > 0.8) {
      return { score: partialScore, distanceKm: 0.1 };
    }

    // For lower partial matches, you might want to implement
    // actual geocoding and distance calculation here
    // For now, return the partial score with estimated distance
    const estimatedDistance = (1 - partialScore) * 5; // Rough estimate
    
    return { score: partialScore, distanceKm: estimatedDistance };
  }

  /**
   * Calculate time overlap between trip and WFX entry
   * @param {Object} trip - CSV trip
   * @param {Object} wfxEntry - WFX timesheet entry
   * @returns {Object} Time match score and offset
   */
  calculateTimeMatch(trip, wfxEntry) {
    // Convert times to minutes for calculation
    const tripStart = this.timeToMinutes(trip['Started, time']);
    const tripEnd = this.timeToMinutes(trip['Finish, time']);
    const tripDuration = tripEnd - tripStart;

    // WFX entry time (may need to be inferred or calculated)
    const wfxStart = this.timeToMinutes(wfxEntry.startTime || '09:00');
    const wfxEnd = wfxStart + (wfxEntry.minutes || 60);

    // Calculate overlap
    const overlapStart = Math.max(tripStart, wfxStart);
    const overlapEnd = Math.min(tripEnd, wfxEnd);
    const overlap = Math.max(0, overlapEnd - overlapStart);

    // Calculate scores
    const totalCovered = Math.max(tripEnd - tripStart, wfxEnd - wfxStart);
    const overlapScore = totalCovered > 0 ? overlap / totalCovered : 0;

    // Calculate time offset (how far apart are the start times)
    const offsetMinutes = Math.abs(tripStart - wfxStart);

    return {
      score: overlapScore,
      offsetMinutes: offsetMinutes
    };
  }

  /**
   * Calculate duration match between trip and timesheet entry
   * @param {Object} trip - CSV trip
   * @param {Object} wfxEntry - WFX entry
   * @returns {number} Duration match score (0-1)
   */
  calculateDurationMatch(trip, wfxEntry) {
    const tripDuration = this.timeToMinutes(trip['Driving Time']) || 0;
    const wfxDuration = wfxEntry.minutes || 0;

    if (tripDuration === 0 || wfxDuration === 0) return 0;

    const ratio = Math.min(tripDuration, wfxDuration) / Math.max(tripDuration, wfxDuration);
    return ratio;
  }

  /**
   * Calculate job type match score
   * @param {Object} trip - CSV trip
   * @param {Object} wfxEntry - WFX entry
   * @returns {number} Job type match score (0-1)
   */
  calculateJobTypeMatch(trip, wfxEntry) {
    // This could be enhanced based on job categories, task types, etc.
    // For now, return a neutral score
    return 0.5;
  }

  /**
   * Perform fuzzy matching for remaining unmatched entries
   * @param {Object} results - Current matching results
   * @param {Object} staffConfig - Staff configuration
   */
  async performFuzzyMatching(results, staffConfig) {
    // Implement fuzzy matching logic for remaining entries
    // This could include proximity-based matching, time-window matching, etc.
    
    // For now, try to match based on relaxed criteria
    for (let i = results.unmatchedTrips.length - 1; i >= 0; i--) {
      const trip = results.unmatchedTrips[i];
      
      for (let j = results.unmatchedWfxEntries.length - 1; j >= 0; j--) {
        const wfxEntry = results.unmatchedWfxEntries[j];
        
        // Relaxed matching with lower confidence threshold
        const matchScore = await this.calculateMatchScore(trip, wfxEntry, staffConfig);
        
        if (matchScore.confidence > config.processing.jobMatching.fuzzyMatchThreshold) { // Use config threshold for fuzzy matching
          results.matched.push({
            trip,
            wfxEntry,
            confidence: matchScore.confidence,
            matchCriteria: [...matchScore.criteria, 'fuzzy_match'],
            locationMatch: matchScore.locationMatch,
            timeMatch: matchScore.timeMatch,
            distanceKm: matchScore.distanceKm,
            timeOffsetMinutes: matchScore.timeOffsetMinutes
          });
          
          results.unmatchedTrips.splice(i, 1);
          results.unmatchedWfxEntries.splice(j, 1);
          break;
        }
      }
    }
  }

  /**
   * Fetch detailed job information for WFX entries
   * @param {Array} wfxEntries - WFX timesheet entries
   * @returns {Object} Job details mapped by job ID
   */
  async fetchJobDetails(wfxEntries) {
    const jobDetails = {};
    const uniqueJobIds = [...new Set(wfxEntries.map(entry => entry.jobId).filter(Boolean))];

    for (const jobId of uniqueJobIds) {
      try {
        // Use the actual WFX API to fetch job details
        const jobDetail = await this.wfxClient.getJob(jobId);
        jobDetails[jobId] = {
          id: jobId,
          name: jobDetail.name || `Job ${jobId}`,
          address: jobDetail.address || jobDetail.location || null,
          client: jobDetail.client?.name || jobDetail.clientName || 'Unknown Client',
          description: jobDetail.description || jobDetail.notes || '',
          category: jobDetail.category || null,
          status: jobDetail.status || null
        };
      } catch (error) {
        console.warn(`Could not fetch job details for ${jobId}:`, error.message);
        // Fallback to basic info if API call fails
        jobDetails[jobId] = {
          id: jobId,
          name: `Job ${jobId}`,
          address: null,
          client: 'Unknown Client',
          description: 'Job details unavailable'
        };
      }
    }

    return jobDetails;
  }

  /**
   * Helper methods
   */
  
  normalizeAddress(address) {
    return address.toLowerCase()
      .replace(/\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct)\b/g, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  calculatePartialAddressMatch(addr1, addr2) {
    const words1 = addr1.split(' ').filter(w => w.length > 2);
    const words2 = addr2.split(' ').filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const matches = words1.filter(word => words2.includes(word));
    return matches.length / Math.max(words1.length, words2.length);
  }

  timeToMinutes(timeString) {
    if (!timeString) return 0;
    const [hours, minutes] = timeString.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  }

  calculateDaySummary(dayComparison) {
    const matched = dayComparison.jobMatches;
    dayComparison.summary.matchedHours = matched.reduce((sum, match) => 
      sum + (match.wfxEntry.minutes || 0) / 60, 0);
    
    if (matched.length > 0) {
      dayComparison.summary.locationMatchRate = 
        matched.reduce((sum, match) => sum + match.locationMatch, 0) / matched.length;
      dayComparison.summary.timeMatchRate = 
        matched.reduce((sum, match) => sum + match.timeMatch, 0) / matched.length;
    }
  }

  updateSummaryStats(summary, dayComparison) {
    summary.matchedJobs += dayComparison.jobMatches.length;
    summary.unmatchedTrips += dayComparison.unmatchedTrips.length;
    summary.unmatchedWfxEntries += dayComparison.unmatchedWfxEntries.length;
  }

  calculateAccuracyMetrics(summary) {
    const totalJobs = summary.matchedJobs + summary.unmatchedWfxEntries;
    const totalTrips = summary.matchedJobs + summary.unmatchedTrips;
    
    summary.locationMatchAccuracy = totalJobs > 0 ? 
      (summary.matchedJobs / totalJobs * 100).toFixed(1) : 0;
    summary.timeMatchAccuracy = totalTrips > 0 ? 
      (summary.matchedJobs / totalTrips * 100).toFixed(1) : 0;
  }
}

module.exports = EnhancedJobMatcher; 