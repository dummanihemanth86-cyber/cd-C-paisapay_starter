const staticConfig = require('./app.json');

module.exports = ({ config }) => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  return {
    ...staticConfig.expo,
    ...config,
    extra: {
      ...staticConfig.expo.extra,
      ...config.extra,
      ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}),
    },
  };
};
