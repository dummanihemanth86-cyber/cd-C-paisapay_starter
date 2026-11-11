import { describe, expect, it } from 'vitest';
import { getConfiguredUserAppRelease, USER_APP_PACKAGE_ID } from '../modules/appRelease/release.js';

describe('User App release metadata', () => {
  const valid = {
    version: '1.0.1',
    buildCode: 2,
    minSupportedBuildCode: 0,
    apkUrl: 'https://github.com/example/paisapay/releases/download/v1.0.1/paisapay-user.apk',
    sha256: 'A'.repeat(64),
    releaseNotes: 'Improves app updates.',
  };

  it('returns a public release record only when APK URL and integrity metadata are configured', () => {
    expect(getConfiguredUserAppRelease(valid)).toEqual({
      appId: USER_APP_PACKAGE_ID,
      version: '1.0.1',
      buildCode: 2,
      minSupportedBuildCode: 0,
      apkUrl: valid.apkUrl,
      sha256: 'a'.repeat(64),
      releaseNotes: valid.releaseNotes,
    });
  });

  it.each([
    { ...valid, version: undefined },
    { ...valid, buildCode: undefined },
    { ...valid, apkUrl: undefined },
    { ...valid, sha256: undefined },
    { ...valid, apkUrl: 'http://github.com/example/app.apk' },
    { ...valid, apkUrl: 'https://user:password@example.com/app.apk' },
    { ...valid, apkUrl: 'https://example.com/app.apk?token=secret' },
    { ...valid, sha256: 'not-a-digest' },
    { ...valid, minSupportedBuildCode: -1 },
    { ...valid, minSupportedBuildCode: 3 },
  ])('fails closed for incomplete or unsafe release metadata', (config) => {
    expect(getConfiguredUserAppRelease(config)).toBeNull();
  });
});
