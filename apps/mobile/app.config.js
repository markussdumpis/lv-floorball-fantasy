// Ensure Expo picks up environment variables (including EXPO_PUBLIC_DIAGNOSTICS_LOGGING)
require('dotenv').config();

const base = require('./app.json');
const SECURE_STORE_PLUGIN = 'expo-secure-store';

module.exports = () => {
  const existingPlugins = Array.isArray(base.expo?.plugins) ? base.expo.plugins : [];
  const hasSecureStorePlugin = existingPlugins.some((plugin) =>
    Array.isArray(plugin) ? plugin[0] === SECURE_STORE_PLUGIN : plugin === SECURE_STORE_PLUGIN
  );
  const plugins = hasSecureStorePlugin
    ? existingPlugins
    : [...existingPlugins, SECURE_STORE_PLUGIN];

  return {
    expo: {
      ...base.expo,
      plugins,
      extra: {
        ...(base.expo?.extra ?? {}),
        diagnosticsLogging: 'false',
      },
    },
  };
};
