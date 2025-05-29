const fs = require('fs');
const { parse } = require('csv-parse');

/**
 * Normalize date format to standard format
 * @param {string} dateString - Date in various formats
 * @returns {string} Normalized date string
 */
function normalizeDate(dateString) {
  if (!dateString) return '';
  
  // Handle different date formats
  const date = new Date(dateString);
  if (isNaN(date)) {
    // Try parsing DD/MM/YYYY format
    const parts = dateString.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const normalizedDate = new Date(year, month - 1, day);
      if (!isNaN(normalizedDate)) {
        return normalizedDate.toISOString().split('T')[0];
      }
    }
    return dateString; // Return original if can't parse
  }
  
  return date.toISOString().split('T')[0];
}

/**
 * Normalize time format
 * @param {string} timeString - Time in various formats
 * @returns {string} Normalized time string (HH:MM)
 */
function normalizeTime(timeString) {
  if (!timeString) return '00:00';
  
  // Handle different time formats
  const timeParts = timeString.split(':');
  if (timeParts.length >= 2) {
    const hours = parseInt(timeParts[0]).toString().padStart(2, '0');
    const minutes = parseInt(timeParts[1]).toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  
  return timeString;
}

/**
 * Validate required CSV columns
 * @param {Object} row - CSV row object
 * @returns {boolean} True if row has required columns
 */
function validateRow(row) {
  const requiredColumns = [
    'Started, date',
    'Started, time',
    'Address from',
    'Finish, date', 
    'Finish, time',
    'Address to'
  ];
  
  return requiredColumns.every(col => row[col] && row[col].trim() !== '');
}

/**
 * Clean and validate numeric value
 * @param {string|number} value - Value to clean
 * @param {number} defaultValue - Default value if invalid
 * @returns {number} Cleaned numeric value
 */
function cleanNumeric(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '') return defaultValue;
  const num = parseFloat(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Parse CSV file and extract trip data
 * @param {string} filePath - Path to CSV file
 * @returns {Promise<Array>} Array of trip objects
 */
async function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const trips = [];
    let rowCount = 0;
    let validRows = 0;
    let errors = [];
    
    fs.createReadStream(filePath)
      .pipe(parse({ 
        columns: true,
        skip_empty_lines: true,
        trim: true,
        skip_lines_with_error: true
      }))
      .on('data', (row) => {
        rowCount++;
        
        // Skip rows without essential data
        if (!validateRow(row)) {
          errors.push(`Row ${rowCount}: Missing required data`);
          return;
        }
        
        try {
          // Standardize the data format with optimized processing
          const trip = {
            'Number Plate': (row['Number Plate'] || '').trim(),
            'Driver': (row['Driver'] || 'Unknown').trim(),
            'Started, date': normalizeDate(row['Started, date']),
            'Started, time': normalizeTime(row['Started, time']),
            'Address from': (row['Address from'] || '').trim(),
            'Finish, date': normalizeDate(row['Finish, date']),
            'Finish, time': normalizeTime(row['Finish, time']),
            'Address to': (row['Address to'] || '').trim(),
            'Distance': cleanNumeric(row['Distance (km)'] || row['Distance']),
            'Driving Time': row['Driving Time (HH:MM:SS)'] || row['Driving Time'] || '00:00:00',
            'Idling Time': row['Idling Time (HH:MM:SS)'] || row['Idling Time'] || '00:00:00',
            'Parking Time': row['Parking Time (HH:MM:SS)'] || row['Parking Time'] || '00:00:00',
            'Average Speed': cleanNumeric(row['Average Speed']),
            'Max Speed': cleanNumeric(row['Max Speed']),
            'Start Odometer': cleanNumeric(row['Start Odometer']),
            'End Odometer': cleanNumeric(row['End Odometer'])
          };
          
          // Additional validation
          if (trip['Distance'] < 0 || trip['Distance'] > 1000) {
            errors.push(`Row ${rowCount}: Invalid distance ${trip['Distance']}km`);
            return;
          }
          
          validRows++;
          trips.push(trip);
        } catch (error) {
          errors.push(`Row ${rowCount}: Processing error - ${error.message}`);
        }
      })
      .on('end', () => {
        // Sort trips by date and time for better performance
        trips.sort((a, b) => {
          const dateTimeA = new Date(`${a['Started, date']} ${a['Started, time']}`);
          const dateTimeB = new Date(`${b['Started, date']} ${b['Started, time']}`);
          return dateTimeA - dateTimeB;
        });
        
        console.log(`📊 CSV Processing: ${validRows}/${rowCount} valid rows processed`);
        if (errors.length > 0 && errors.length <= 5) {
          console.warn('⚠️ Warnings:', errors.slice(0, 5));
        } else if (errors.length > 5) {
          console.warn(`⚠️ ${errors.length} warnings (showing first 5):`, errors.slice(0, 5));
        }
        
        resolve(trips);
      })
      .on('error', (error) => {
        reject(new Error(`CSV parsing error: ${error.message}`));
      });
  });
}

/**
 * Group trips by date (optimized version)
 * @param {Array} trips - Array of trip objects
 * @returns {Object} Trips grouped by date
 */
function groupTripsByDate(trips) {
  // Use reduce for better performance than forEach
  return trips.reduce((grouped, trip) => {
    const date = trip['Started, date'];
    if (!grouped[date]) {
      grouped[date] = [];
    }
    grouped[date].push(trip);
    return grouped;
  }, {});
}

/**
 * Calculate time duration in minutes from HH:MM:SS format (optimized)
 * @param {string} timeString - Time in HH:MM:SS format
 * @returns {number} Duration in minutes
 */
function timeToMinutes(timeString) {
  if (!timeString || typeof timeString !== 'string') return 0;
  
  const parts = timeString.split(':');
  if (parts.length < 2) return 0;
  
  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const seconds = parts.length > 2 ? (parseInt(parts[2]) || 0) : 0;
  
  return hours * 60 + minutes + seconds / 60;
}

/**
 * Format minutes to HH:MM:SS (optimized)
 * @param {number} minutes - Duration in minutes
 * @returns {string} Formatted time string
 */
function minutesToTime(minutes) {
  if (typeof minutes !== 'number' || isNaN(minutes)) return '00:00:00';
  
  const totalSeconds = Math.round(minutes * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Identify home address from trip data (optimized)
 * @param {Array} trips - Array of trip objects
 * @returns {string} Most frequent start/end address (likely home)
 */
function identifyHomeAddress(trips) {
  if (!trips || trips.length === 0) return '';
  
  const addressFrequency = new Map();
  
  // Use for...of for better performance with large arrays
  for (const trip of trips) {
    // Count start addresses
    const fromAddr = trip['Address from'];
    if (fromAddr) {
      addressFrequency.set(fromAddr, (addressFrequency.get(fromAddr) || 0) + 1);
    }
    
    // Count end addresses
    const toAddr = trip['Address to'];
    if (toAddr) {
      addressFrequency.set(toAddr, (addressFrequency.get(toAddr) || 0) + 1);
    }
  }
  
  // Find most frequent address efficiently
  let homeAddress = '';
  let maxFrequency = 0;
  
  for (const [address, frequency] of addressFrequency) {
    if (frequency > maxFrequency) {
      maxFrequency = frequency;
      homeAddress = address;
    }
  }
  
  return homeAddress;
}

/**
 * Get CSV file statistics
 * @param {Array} trips - Array of trip objects
 * @returns {Object} Statistics object
 */
function getCSVStats(trips) {
  if (!trips || trips.length === 0) {
    return {
      totalTrips: 0,
      dateRange: null,
      totalDistance: 0,
      totalDrivingTime: 0,
      uniqueDates: 0
    };
  }
  
  const dates = new Set();
  let totalDistance = 0;
  let totalDrivingTime = 0;
  
  for (const trip of trips) {
    dates.add(trip['Started, date']);
    totalDistance += trip['Distance'] || 0;
    totalDrivingTime += timeToMinutes(trip['Driving Time']);
  }
  
  const sortedDates = Array.from(dates).sort();
  
  return {
    totalTrips: trips.length,
    dateRange: {
      start: sortedDates[0],
      end: sortedDates[sortedDates.length - 1]
    },
    totalDistance: Math.round(totalDistance * 100) / 100,
    totalDrivingTime: Math.round(totalDrivingTime),
    uniqueDates: dates.size
  };
}

module.exports = {
  parseCSV,
  groupTripsByDate,
  timeToMinutes,
  minutesToTime,
  identifyHomeAddress,
  getCSVStats,
  normalizeDate,
  normalizeTime,
  validateRow
}; 