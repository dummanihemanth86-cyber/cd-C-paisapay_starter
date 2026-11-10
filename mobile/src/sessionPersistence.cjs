function createSessionPersistencePolicy(initiallyRemembered = true) {
  let remembered = initiallyRemembered;
  return {
    setRemembered(value) { remembered = value === true; },
    shouldPersist() { return remembered; },
    reset() { remembered = true; },
  };
}

module.exports = { createSessionPersistencePolicy };
