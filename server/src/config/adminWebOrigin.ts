export const STAGING_ADMIN_WEB_ORIGIN = 'https://dummanihemanth86-cyber.github.io';
export const STAGING_SWAGGER_API_ORIGIN = 'https://paisapay-api-staging.onrender.com';

export function isAllowedApiOrigin(
  origin: string | undefined,
  options: { apiProductionOrigin: string; appOrigins: string[]; isDevelopment: boolean; isExplicitRenderStaging: boolean },
): boolean {
  // Swagger is served by the staging API itself. Keep it staging-only even if
  // someone accidentally adds the hostname to the general application origins.
  if (origin === STAGING_SWAGGER_API_ORIGIN) return options.isExplicitRenderStaging;
  if (!origin || origin === options.apiProductionOrigin || options.appOrigins.includes(origin)) return true;
  if (options.isExplicitRenderStaging && origin === STAGING_ADMIN_WEB_ORIGIN) return true;
  if (options.isDevelopment && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) return true;
  return false;
}
