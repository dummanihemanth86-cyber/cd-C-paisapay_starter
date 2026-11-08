import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AdminRole } from '../../generated/prisma/enums.js';
import { env } from '../../config/env.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const AUTHORIZED_PAYMENT_ROLES: AdminRole[] = ['FINANCE', 'ADMIN', 'SUPER_ADMIN'];
const MAX_ATTEMPTS = 10;
const PREPARE_BATCH_SIZE = 10;
const DELIVERY_BATCH_SIZE = 25;
const TRANSACTION_MAX_WAIT_MS = 15_000;
const TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_RETRY_DELAYS_MS = [100, 300, 900] as const;
const STALE_DELIVERY_LOCK_MS = 2 * 60_000;

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

function prismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isRetryableTransactionError(error: unknown) {
  return ['P2028', 'P2024', 'P2034'].includes(prismaErrorCode(error) ?? '');
}

async function withTransactionRetry<T>(
  db: PrismaClient,
  operation: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        maxWait: TRANSACTION_MAX_WAIT_MS,
        timeout: TRANSACTION_TIMEOUT_MS,
      });
    } catch (error) {
      const delay = TRANSACTION_RETRY_DELAYS_MS[attempt];
      if (!isRetryableTransactionError(error) || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function retryAt(attemptCount: number) {
  const delayMs = Math.min(6 * 60 * 60_000, 15_000 * (2 ** Math.min(8, Math.max(0, attemptCount - 1))));
  return new Date(Date.now() + delayMs);
}

async function prepareEventDeliveries(db: PrismaClient, limit = PREPARE_BATCH_SIZE) {
  return withTransactionRetry(db, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM admin_push_events
      WHERE deliveries_prepared_at IS NULL
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}`;
    const devices = rows.length ? await tx.adminPushDevice.findMany({
      where: { revokedAt: null, adminUser: { role: { in: AUTHORIZED_PAYMENT_ROLES } } },
      select: { id: true },
    }) : [];
    for (const row of rows) {
      if (devices.length) await tx.adminPushDelivery.createMany({ data: devices.map((device) => ({ eventId: row.id, deviceId: device.id })), skipDuplicates: true });
      await tx.adminPushEvent.update({ where: { id: row.id }, data: { deliveriesPreparedAt: new Date() } });
    }
    return rows.length;
  });
}

async function claimDeliveries(db: PrismaClient, limit = DELIVERY_BATCH_SIZE) {
  return withTransactionRetry(db, async (tx) => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_DELIVERY_LOCK_MS);
    await tx.adminPushDelivery.updateMany({
      where: { status: 'SENDING', lockedAt: { lt: staleBefore } },
      data: {
        status: 'FAILED',
        lockedAt: null,
        lastError: 'Provider outcome unknown after worker interruption; not retried to prevent duplicate notification.',
      },
    });
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT d.id FROM admin_push_deliveries d
      JOIN admin_push_events e ON e.id = d.event_id
      JOIN admin_push_devices device ON device.id = d.device_id
      WHERE d.status IN ('PENDING', 'RETRY') AND d.next_attempt_at <= ${now}
        AND d.locked_at IS NULL
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

async function failAmbiguousDelivery(db: PrismaClient, deliveryId: string) {
  await db.adminPushDelivery.update({ where: { id: deliveryId }, data: {
    status: 'FAILED',
    lockedAt: null,
    lastError: 'Provider outcome unknown; not retried to prevent duplicate notification.',
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
  } catch {
    // A timeout/invalid response can happen after Expo accepted the batch. Treat this as
    // terminal and require operator review; retrying could send duplicate notifications.
    await Promise.all(deliveries.map((delivery) => failAmbiguousDelivery(db, delivery.id)));
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
