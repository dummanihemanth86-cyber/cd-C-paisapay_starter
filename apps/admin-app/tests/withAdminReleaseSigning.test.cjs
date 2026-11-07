const test = require('node:test');
const assert = require('node:assert/strict');
const { configureAdminReleaseSigning } = require('../plugins/withAdminReleaseSigning');

const generatedGradle = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

test('configures protected release signing and never uses the debug signer for release', () => {
  const configured = configureAdminReleaseSigning(generatedGradle);
  const releaseBlock = configured.slice(configured.indexOf('        release {'));

  assert.match(configured, /PAISAPAY_ADMIN_STORE_FILE/);
  assert.match(configured, /releaseBuildRequested && !adminReleaseSigningConfigured/);
  assert.match(configured, /adminRelease \{/);
  assert.match(releaseBlock, /signingConfig signingConfigs\.adminRelease/);
  assert.doesNotMatch(releaseBlock, /signingConfig signingConfigs\.debug/);
});

test('release-signing prebuild transform is idempotent', () => {
  const configured = configureAdminReleaseSigning(generatedGradle);
  assert.equal(configureAdminReleaseSigning(configured), configured);
});
