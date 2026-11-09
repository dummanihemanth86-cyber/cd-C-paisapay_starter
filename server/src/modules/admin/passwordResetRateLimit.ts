import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';

type IpRequest = { ip: string | undefined; get: (name: string) => string | undefined };

/**
 * Render staging sits behind Cloudflare and Render proxies. Express's default
 * req.ip is the local proxy address, so the default limiter can become global.
 * Trust CF-Connecting-IP only on the explicitly identified staging service;
 * Cloudflare overwrites this header at its edge. Elsewhere, preserve Express's
 * configured request IP behavior. ipKeyGenerator keeps IPv6 subnet limits safe.
 */
export function adminPasswordResetIpKey(req: IpRequest, isExplicitRenderStaging: boolean): string {
  const cloudflareClientIp = isExplicitRenderStaging ? req.get('cf-connecting-ip') : undefined;
  const clientIp = cloudflareClientIp && isIP(cloudflareClientIp) ? cloudflareClientIp : req.ip ?? 'unknown';
  return `admin-reset-ip:${ipKeyGenerator(clientIp)}`;
}
