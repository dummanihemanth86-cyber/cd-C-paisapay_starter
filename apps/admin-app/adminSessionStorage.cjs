function createAdminSessionStorage({ platform, secureStore, getWebStorage }) {
  if (platform === 'web') {
    const webStore = () => {
      const storage = getWebStorage?.();
      if (!storage) throw new Error('Browser session storage is unavailable. Sign in again in a supported browser tab.');
      return storage;
    };
    return {
      getItemAsync: async (key) => webStore().getItem(key),
      setItemAsync: async (key, value) => webStore().setItem(key, value),
      deleteItemAsync: async (key) => webStore().removeItem(key),
    };
  }
  return secureStore;
}

module.exports = { createAdminSessionStorage };
