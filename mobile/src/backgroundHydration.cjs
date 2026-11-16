'use strict';

function runInBackground(task, onError = () => {}) {
  return Promise.resolve()
    .then(task)
    .catch((error) => {
      try { onError(error); } catch { /* UI error reporting must not become an unhandled rejection. */ }
    });
}

module.exports = { runInBackground };
