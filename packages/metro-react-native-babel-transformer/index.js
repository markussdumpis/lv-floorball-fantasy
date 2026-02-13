// Local fallback transformer that re-exports Expo's bundled transformer.
const path = require('path');

const expoTransformerPath = path.resolve(
  __dirname,
  '../../apps/mobile/node_modules/@expo/metro-config/babel-transformer',
);

module.exports = require(expoTransformerPath);
