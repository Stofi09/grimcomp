const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Resolve "@/foo" to "src/foo"
config.resolver.extraNodeModules = {
  '@': path.resolve(__dirname, 'src'),
};

module.exports = config;
