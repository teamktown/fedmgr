/**
 * Jest Configuration
 * 
 * Configuration for Jest test runner.
 */

module.exports = {
  // The root directory that Jest should scan for tests and modules
  rootDir: '.',
  
  // The test environment that will be used for testing
  testEnvironment: 'node',
  
  // The glob patterns Jest uses to detect test files
  testMatch: [
    '**/scripts/tests/**/*.test.js'
  ],
  
  // An array of regexp pattern strings that are matched against all test paths
  // Tests that match these patterns will be skipped
  testPathIgnorePatterns: [
    '/node_modules/'
  ],
  
  // An array of regexp pattern strings that are matched against all source file paths
  // If a file matches, it will not be transformed
  transformIgnorePatterns: [
    // Allow ESM modules to be transformed
    '/node_modules/(?!(node-fetch|fetch-blob|formdata-polyfill|data-uri-to-buffer|web-streams-polyfill)/)'
  ],
  
  // Indicates whether each individual test should be reported during the run
  verbose: true,
  
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  
  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: false,
  
  // The directory where Jest should output its coverage files
  coverageDirectory: 'test-coverage',
  
  // An array of regexp pattern strings used to skip coverage collection
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/scripts/tests/'
  ],
  
  // A list of reporter names that Jest uses when writing coverage reports
  coverageReporters: [
    'json',
    'text',
    'lcov',
    'clover'
  ],
  
  // A map from regular expressions to paths to transformers
  transform: {
    "node_modules/node-fetch/.*": "<rootDir>/jest-transform-stub.js",
    "node_modules/fetch-blob/.*": "<rootDir>/jest-transform-stub.js",
    "node_modules/formdata-polyfill/.*": "<rootDir>/jest-transform-stub.js",
    "node_modules/web-streams-polyfill/.*": "<rootDir>/jest-transform-stub.js"
  },
  
  // The paths to modules that run some code to configure or set up the testing environment
  setupFiles: [
    '<rootDir>/scripts/tests/fixtures/setup.js'
  ],
  
  // A list of paths to modules that run some code to configure or set up the testing framework
  setupFilesAfterEnv: [],
  
  // The maximum amount of workers used to run your tests (defaults to number of CPUs - 1)
  maxWorkers: '50%',
  
  // An object that configures minimum threshold enforcement for coverage results
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // An array of directory names to be searched recursively up from the requiring module's location
  moduleDirectories: [
    'node_modules'
  ],
  
  // A map from regular expressions to module names that allow to stub out resources
  moduleNameMapper: {},
  
  // Allows you to use a custom runner instead of Jest's default test runner
  runner: 'jest-runner',
  
  // The paths to modules that run some code to configure or set up the testing framework before each test
  setupFilesAfterEnv: [],
  
  // The test results processor used by Jest
  testResultsProcessor: null,
  
  // This option allows the use of a custom results processor
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'junit.xml'
      }
    ]
  ],
  
  // This option allows use of a custom test runner
  testRunner: 'jest-circus/runner',
  
  // Test environment options
  testEnvironmentOptions: {
    url: 'http://localhost'
  },
  
  // Setting this value to "fake" allows the use of fake timers for functions such as "setTimeout"
  fakeTimers: {
    enableGlobally: false
  },
  
  // An array of regexp pattern strings that are matched against all modules before they are loaded
  watchPathIgnorePatterns: [],
  
  // Whether to use watchman for file crawling
  watchman: true
};