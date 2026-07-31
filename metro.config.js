const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const localDirectory = path.resolve(__dirname, ".local");
const localDirectoryPattern = new RegExp(
  `^${localDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/\\\\]|$)`,
);

config.watchFolders = (config.watchFolders || []).filter(
  (folder) => path.resolve(folder) !== localDirectory,
);

config.resolver = config.resolver || {};
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
    ? [config.resolver.blockList]
    : []),
  localDirectoryPattern,
];

module.exports = config;
