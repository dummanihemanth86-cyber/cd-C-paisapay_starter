import { describe, expect, it } from 'vitest';
import { getConfiguredUserAppRelease, USER_APP_PACKAGE_ID } from '../modules/appRelease/release.js';

describe('User App release metadata', () => {
  const valid = {
    version: '1.1.28',
    buildCode: 39,
    minSupportedBuildCode: 0,
    apkUrl: 'https://github.com/dummanihemanth86-cyber/cd-C-paisapay_starter/releases/download/v1.1.28/paisapay-user-1.1.28.apk',
    sha256: 'A'.repeat(64),
    releaseNotes: 'Improves the PaisaPay User App.',
  };

  it('returns a public release record only when APK URL and integrity metadata are configured', () => {
    expect(getConfiguredUserAppRelease(valid)).toEqual({
      appId: USER_APP_PACKAGE_ID,
      ...valid,
      sha256: 'a'.repeat(64),
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
    { ...valid, minSupportedBuildCode: 40 },
  ])('fails closed for incomplete or unsafe release metadata', (config) => {
    expect(getConfiguredUserAppRelease(config)).toBeNull();
  });
});
