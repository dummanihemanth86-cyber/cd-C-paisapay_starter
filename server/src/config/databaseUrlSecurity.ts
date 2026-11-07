/** Validates a PostgreSQL URL for production/runtime and migration connections. */
export const assertProductionDatabaseUrl = (name: string, value: string): void => {
  let databaseUrl: URL;
  try { databaseUrl = new URL(value); } catch { throw new Error(`${name} must be a valid PostgreSQL connection URL.`); }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error(`${name} must use a PostgreSQL connection URL.`);
  }
  const hostname = databaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(`${name} must point to a remote PostgreSQL service, not localhost.`);
  }
  const sslModes = databaseUrl.searchParams.getAll('sslmode');
  // Reject duplicate sslmode parameters: URL consumers can disagree about
  // whether the first or last value wins, which could silently disable TLS.
  if (sslModes.length !== 1 || !['require', 'verify-full'].includes(sslModes[0])) {
    throw new Error(`${name} must enable TLS with sslmode=require or sslmode=verify-full.`);
  }
};
