export const STAGING_ADMIN_WEB_ORIGIN = 'https://dummanihemanth86-cyber.github.io';

export function isAllowedApiOrigin(
  origin: string | undefined,
  options: { apiProductionOrigin: string; appOrigins: string[]; isDevelopment: boolean; isExplicitRenderStaging: boolean },
): boolean {
  if (!origin || origin === options.apiProductionOrigin || options.appOrigins.includes(origin)) return true;
  if (options.isExplicitRenderStaging && origin === STAGING_ADMIN_WEB_ORIGIN) return true;
  if (options.isDevelopment && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) return true;
  return false;
}
