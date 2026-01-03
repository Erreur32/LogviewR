/**
 * Test setup file
 * Configures environment for tests
 */

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
