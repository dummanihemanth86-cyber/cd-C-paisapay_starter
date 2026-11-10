'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const easConfig = require('../eas.json');
const { PRODUCTION_API, resolveApiBaseUrl } = require('../src/apiEnvironment.cjs');

function resolveProductionBuildEnvironment(config) {
  const productionProfile = config?.build?.['production-apk'];
  const profileEnv = productionProfile?.env;
  if (!profileEnv?.EXPO_PUBLIC_API_URL || !profileEnv?.EXPO_PUBLIC_DEPLOYMENT_ENV) {
    throw new Error('The production-apk profile must explicitly set EXPO_PUBLIC_API_URL and EXPO_PUBLIC_DEPLOYMENT_ENV.');
  }
  if (profileEnv.EXPO_PUBLIC_DEPLOYMENT_ENV !== 'production') {
    throw new Error('The production-apk profile must use EXPO_PUBLIC_DEPLOYMENT_ENV=production.');
  }

  const apiUrl = resolveApiBaseUrl({
    apiUrl: profileEnv.EXPO_PUBLIC_API_URL,
    deploymentEnv: profileEnv.EXPO_PUBLIC_DEPLOYMENT_ENV,
    isDev: false,
  });
  if (apiUrl !== PRODUCTION_API) throw new Error('The production-apk profile does not use the approved production API origin.');
  return { EXPO_PUBLIC_API_URL: apiUrl, EXPO_PUBLIC_DEPLOYMENT_ENV: 'production' };
}

function main() {
  const buildEnv = resolveProductionBuildEnvironment(easConfig);
  const env = { ...process.env, ...buildEnv };
  const isWindows = process.platform === 'win32';
  const gradle = isWindows ? 'gradlew.bat' : './gradlew';
  const result = spawnSync(gradle, ['assembleRelease'], {
    cwd: path.resolve(__dirname, '../android'),
    env,
    shell: isWindows,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Production APK build stopped: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { resolveProductionBuildEnvironment };
