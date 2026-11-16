const REMEMBERED_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function createSessionPersistencePolicy(initiallyRemembered = true) {
  let remembered = initiallyRemembered;
  return {
    setRemembered(value) { remembered = value === true; },
    shouldPersist() { return remembered; },
    reset() { remembered = true; },
  };
}

function rememberedSessionStartedAt(session, now = Date.now()) {
  const value = session?.rememberedAt;
  const startedAt = value === null || value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(startedAt) ? startedAt : now;
}

function isRememberedSessionExpired(session, now = Date.now()) {
  const value = session?.rememberedAt;
  const startedAt = value === null || value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(startedAt) && now - startedAt >= REMEMBERED_SESSION_MAX_AGE_MS;
}

module.exports = {
  REMEMBERED_SESSION_MAX_AGE_MS,
  createSessionPersistencePolicy,
  isRememberedSessionExpired,
  rememberedSessionStartedAt,
};
