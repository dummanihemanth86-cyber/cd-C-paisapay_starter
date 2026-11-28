/** Shared, pinned database identity for explicit staging-only Admin provisioning. */
export const STAGING_DATABASE_HOST = 'dpg-dbnnr3jl550s73fnn4f0-a.oregon-postgres.render.com';
export const STAGING_DATABASE_NAME = 'paisapay_staging';

export function validateStagingDatabaseTarget(connectionString: string | undefined) {
  if (!connectionString) throw new Error('Set the isolated staging database URL.');

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('The staging database URL is invalid.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname.toLowerCase() !== STAGING_DATABASE_HOST) {
    throw new Error('The database URL host does not match the isolated PaisaPay Render staging database.');
  }
  if (decodeURIComponent(url.pathname.slice(1)) !== STAGING_DATABASE_NAME) {
    throw new Error('The database URL must target paisapay_staging.');
  }
  const sslModes = url.searchParams.getAll('sslmode');
  if (sslModes.length !== 1 || sslModes[0] !== 'verify-full') {
    throw new Error('The staging database URL must contain exactly one sslmode=verify-full parameter.');
  }
  if (!url.username || !url.password) {
    throw new Error('The staging database URL must include its staging database credentials.');
  }

  return { hostname: url.hostname, database: STAGING_DATABASE_NAME };
}
