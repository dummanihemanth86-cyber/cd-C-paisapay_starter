import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AdminRole } from '../../generated/prisma/enums.js';
import { env } from '../../config/env.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const AUTHORIZED_PAYMENT_ROLES: AdminRole[] = ['FINANCE', 'ADMIN', 'SUPER_ADMIN'];
const MAX_ATTEMPTS = 10;

function retryAt(attemptCount: number) {
  const delayMs = Math.min(6 * 60 * 60_000, 15_000 * (2 ** Math.min(8, Math.max(0, attemptCount - 1))));
  return new Date(Date.now() + delayMs);
}

async function prepareEventDeliveries(db: PrismaClient, limit = 20) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM admin_push_events
      WHERE deliveries_prepared_at IS NULL
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}`;
    for (const row of rows) {
      const devices = await tx.adminPushDevice.findMany({
        where: { revokedAt: null, adminUser: { role: { in: AUTHORIZED_PAYMENT_ROLES } } },
        select: { id: true },
      });
      if (devices.length) await tx.adminPushDelivery.createMany({ data: devices.map((device) => ({ eventId: row.id, deviceId: device.id })), skipDuplicates: true });
      await tx.adminPushEvent.update({ where: { id: row.id }, data: { deliveriesPreparedAt: new Date() } });
    }
    return rows.length;
  });
}

async function claimDeliveries(db: PrismaClient, limit = 100) {
  return db.$transaction(async (tx) => {
    const now = new Date();
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT d.id FROM admin_push_deliveries d
      JOIN admin_push_events e ON e.id = d.event_id
      JOIN admin_push_devices device ON device.id = d.device_id
      WHERE d.status IN ('PENDING', 'RETRY', 'SENDING') AND d.next_attempt_at <= ${now}
        AND (d.locked_at IS NULL OR d.locked_at < ${new Date(now.getTime() - 2 * 60_000)})
        AND device.revoked_at IS NULL
      ORDER BY e.created_at ASC
      FOR UPDATE OF d SKIP LOCKED
      LIMIT ${limit}`;
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    await tx.adminPushDelivery.updateMany({ where: { id: { in: ids } }, data: { status: 'SENDING', lockedAt: now, attemptCount: { increment: 1 } } });
    return tx.adminPushDelivery.findMany({ where: { id: { in: ids } }, include: { event: { select: { id: true, type: true, title: true, body: true, claimId: true } }, device: { select: { id: true, expoPushToken: true } } } });
  });
}

async function failDelivery(db: PrismaClient, delivery: { id: string; attemptCount: number }, message: string, permanent = false) {
  const failed = permanent || delivery.attemptCount >= MAX_ATTEMPTS;
  await db.adminPushDelivery.update({ where: { id: delivery.id }, data: {
    status: failed ? 'FAILED' : 'RETRY', lockedAt: null,
    nextAttemptAt: failed ? new Date() : retryAt(delivery.attemptCount),
    lastError: message.slice(0, 500),
  } });
}

/** Send durable admin outbox records using Expo Push Service. Delivery never changes payment state. */
export async function runAdminPushOutboxBatch(db: PrismaClient) {
  await prepareEventDeliveries(db);
  const deliveries = await claimDeliveries(db);
  if (!deliveries.length) return 0;

  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' };
  if (env.expoPushAccessToken) headers.Authorization = `Bearer ${env.expoPushAccessToken}`;
  const messages = deliveries.map((delivery) => ({
    to: delivery.device.expoPushToken,
    title: delivery.event.title,
    body: delivery.event.body,
    priority: 'high',
    channelId: 'payment-verification',
    data: { type: delivery.event.type, eventId: delivery.event.id, claimId: delivery.event.claimId },
  }));

  let response: Response;
  let result: { data?: Array<{ status?: string; id?: string; message?: string; details?: { error?: string } }> };
  try {
    response = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(12_000) });
    result = await response.json() as typeof result;
    if (!response.ok || !Array.isArray(result.data) || result.data.length !== deliveries.length) throw new Error(`Expo Push Service returned HTTP ${response.status} or an invalid ticket response.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Expo Push Service request failed.';
    await Promise.all(deliveries.map((delivery) => failDelivery(db, delivery, message)));
    return deliveries.length;
  }

  await Promise.all(deliveries.map(async (delivery, index) => {
    const ticket = result.data![index];
    if (ticket.status === 'ok') {
      await db.adminPushDelivery.update({ where: { id: delivery.id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), lockedAt: null, lastError: null } });
      return;
    }
    const code = ticket.details?.error || 'PUSH_DELIVERY_ERROR';
    const reason = ticket.message || code;
    if (code === 'DeviceNotRegistered') {
      await db.$transaction([
        db.adminPushDevice.update({ where: { id: delivery.device.id }, data: { revokedAt: new Date() } }),
        db.adminPushDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', lockedAt: null, lastError: reason.slice(0, 500) } }),
      ]);
      return;
    }
    const permanent = ['InvalidPushToken', 'MessageTooBig', 'MismatchSenderId'].includes(code);
    await failDelivery(db, delivery, reason, permanent);
  }));
  return deliveries.length;
}
