// Lets Metro bundle the shared @gist/core package from the monorepo.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.join(monorepoRoot, "packages")];
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules"), path.join(monorepoRoot, "node_modules")];
module.exports = config;
