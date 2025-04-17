/**
 * Test Logger
 * 
 * A structured logger for tests that provides consistent formatting and log levels.
 */

const fs = require('fs');
const path = require('path');

/**
 * TestLogger class for structured logging in tests
 */
class TestLogger {
  /**
   * Create a new TestLogger instance
   * 
   * @param {string} testId - Unique identifier for the test
   * @param {string} component - Component being tested
   * @param {Object} options - Logger options
   * @param {boolean} options.console - Whether to log to console (default: true)
   * @param {boolean} options.file - Whether to log to file (default: false)
   * @param {string} options.logDir - Directory for log files (default: 'test-results/logs')
   */
  constructor(testId, component, options = {}) {
    this.testId = testId;
    this.component = component;
    this.options = {
      console: true,
      file: false,
      logDir: 'test-results/logs',
      ...options
    };
    
    // Create log directory if logging to file
    if (this.options.file) {
      const logDir = path.join(__dirname, '../../../', this.options.logDir);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      this.logFile = path.join(logDir, `${this.testId}.log`);
    }
  }
  
  /**
   * Format a log message
   * 
   * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
   * @param {string} message - Log message
   * @returns {string} Formatted log message
   */
  formatMessage(level, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${this.testId}] [${this.component}] ${message}`;
  }
  
  /**
   * Log a message
   * 
   * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
   * @param {string} message - Log message
   */
  log(level, message) {
    const formattedMessage = this.formatMessage(level, message);
    
    // Log to console if enabled
    if (this.options.console) {
      console.info(formattedMessage);
    }
    
    // Log to file if enabled
    if (this.options.file) {
      fs.appendFileSync(this.logFile, formattedMessage + '\n');
    }
  }
  
  /**
   * Log an info message
   * 
   * @param {string} message - Log message
   */
  info(message) {
    this.log('INFO', message);
  }
  
  /**
   * Log a warning message
   * 
   * @param {string} message - Log message
   */
  warn(message) {
    this.log('WARN', message);
  }
  
  /**
   * Log an error message
   * 
   * @param {string} message - Log message
   */
  error(message) {
    this.log('ERROR', message);
  }
  
  /**
   * Log a debug message
   * 
   * @param {string} message - Log message
   */
  debug(message) {
    this.log('DEBUG', message);
  }
  
  /**
   * Log the start of a test
   * 
   * @param {string} testName - Name of the test
   */
  startTest(testName) {
    this.info(`Starting test: ${testName}`);
  }
  
  /**
   * Log the end of a test
   * 
   * @param {string} testName - Name of the test
   * @param {boolean} success - Whether the test succeeded
   */
  endTest(testName, success) {
    this.info(`Test ${success ? 'passed' : 'failed'}: ${testName}`);
  }
  
  /**
   * Log a test step
   * 
   * @param {number} stepNumber - Step number
   * @param {string} description - Step description
   */
  step(stepNumber, description) {
    this.info(`Step ${stepNumber}: ${description}`);
  }
  
  /**
   * Log an assertion
   * 
   * @param {string} description - Assertion description
   * @param {boolean} result - Assertion result
   */
  assert(description, result) {
    this.info(`Assertion ${result ? 'passed' : 'failed'}: ${description}`);
  }
}

module.exports = TestLogger;