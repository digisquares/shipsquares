// Test env defaults so loadConfig() succeeds for server tests that build the
// Fastify app. No real DB is contacted — postgres.js connects lazily and these
// tests never issue a query (handlers are stubbed until their services land).
process.env.DATABASE_URL ??= "postgres://localhost:5432/shipsquares_test";
process.env.AUTH_SECRET ??= "test-secret-0123456789abcdef0123456789";
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.NODE_ENV ??= "test";
