const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Native Admin imports the small navigation helper shared with Browser Admin.
// Metro otherwise limits resolution to this app directory and cannot bundle it.
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../../shared')];

module.exports = config;
