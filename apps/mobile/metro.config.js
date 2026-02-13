const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure Metro sees absolute roots even if the config is consumed directly.
config.projectRoot = __dirname;
config.watchFolders = [__dirname];
// Metro expects a reporter; some setups that import this config directly
// (without metro-config's defaults) will otherwise crash during startup.
if (!config.reporter) {
  config.reporter = { update() {} };
}

config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');
config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'svg');
config.resolver.sourceExts.push('svg');
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@': path.resolve(__dirname),
};

module.exports = config;
