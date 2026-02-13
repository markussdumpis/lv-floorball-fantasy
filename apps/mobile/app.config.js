// Ensure Expo picks up environment variables (including EXPO_PUBLIC_DIAGNOSTICS_LOGGING)
require('dotenv').config();

const base = require('./app.json');

module.exports = () => {
  return {
    expo: {
      ...base.expo,
      extra: {
        ...(base.expo?.extra ?? {}),
        diagnosticsLogging: 'false',
      },
    },
  };
};
