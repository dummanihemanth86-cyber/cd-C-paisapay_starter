const { withAppBuildGradle } = require('@expo/config-plugins');

const signingMarker = 'def adminReleaseSigningConfigured';

function configureAdminReleaseSigning(contents) {
  if (contents.includes(signingMarker)) return contents;

  const androidAnchor = '\nandroid {\n';
  if (!contents.includes(androidAnchor)) {
    throw new Error('Could not locate the Android application block for Admin release signing.');
  }

  const signingProperties = `
def adminReleaseStoreFile = findProperty('PAISAPAY_ADMIN_STORE_FILE')
def adminReleaseStorePassword = findProperty('PAISAPAY_ADMIN_STORE_PASSWORD')
def adminReleaseKeyAlias = findProperty('PAISAPAY_ADMIN_KEY_ALIAS')
def adminReleaseKeyPassword = findProperty('PAISAPAY_ADMIN_KEY_PASSWORD')
def adminReleaseSigningConfigured = [adminReleaseStoreFile, adminReleaseStorePassword, adminReleaseKeyAlias, adminReleaseKeyPassword].every { it?.toString()?.trim() }
def releaseBuildRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
if (releaseBuildRequested && !adminReleaseSigningConfigured) {
    throw new GradleException('Admin release builds require PAISAPAY_ADMIN_* signing properties in the user Gradle properties file. Debug signing is not allowed for release builds.')
}
`;
  contents = contents.replace(androidAnchor, `\n${signingProperties}\nandroid {\n`);

  const signingStart = contents.indexOf('    signingConfigs {');
  const buildTypesStart = contents.indexOf('    buildTypes {', signingStart);
  if (signingStart < 0 || buildTypesStart < 0) {
    throw new Error('Could not locate Android signingConfigs/buildTypes for Admin release signing.');
  }
  const signingClose = contents.lastIndexOf('\n    }', buildTypesStart);
  if (signingClose < signingStart) {
    throw new Error('Could not locate the end of Android signingConfigs.');
  }
  const releaseSigning = `
        adminRelease {
            storeFile file(adminReleaseStoreFile ?: 'debug.keystore')
            storePassword adminReleaseStorePassword ?: 'android'
            keyAlias adminReleaseKeyAlias ?: 'androiddebugkey'
            keyPassword adminReleaseKeyPassword ?: 'android'
        }`;
  contents = `${contents.slice(0, signingClose)}${releaseSigning}${contents.slice(signingClose)}`;

  const updatedBuildTypesStart = contents.indexOf('    buildTypes {', signingStart);
  const releaseStart = contents.indexOf('        release {', updatedBuildTypesStart);
  const debugSignerStart = contents.indexOf('signingConfig signingConfigs.debug', releaseStart);
  if (releaseStart < 0 || debugSignerStart < releaseStart) {
    throw new Error('Could not locate the generated release signing assignment.');
  }
  const debugAssignment = 'signingConfig signingConfigs.debug';
  return `${contents.slice(0, debugSignerStart)}signingConfig signingConfigs.adminRelease${contents.slice(debugSignerStart + debugAssignment.length)}`;
}

module.exports = function withAdminReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = configureAdminReleaseSigning(config.modResults.contents);
    return config;
  });
};

module.exports.configureAdminReleaseSigning = configureAdminReleaseSigning;
