import type { Config } from 'jest';

const config: Config = {
  preset:      'ts-jest',
  testEnvironment: 'node',
  rootDir:     'src',
  testMatch:   ['**/__tests__/**/*.test.ts'],
  setupFiles:  ['<rootDir>/__tests__/jest.setup.ts'],
  moduleFileExtensions: ['ts', 'js'],
  collectCoverageFrom: [
    'config/**/*.ts',
    'shared/**/*.ts',
    'modules/**/*.ts',
    '!**/*.d.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  // Don't let Jest spin up the real DB or server unless running integration tests
  testPathIgnorePatterns: [],
};

export default config;
