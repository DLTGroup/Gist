// Lets Metro bundle the shared @gist/core package from the monorepo.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.join(monorepoRoot, "packages")];
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules"), path.join(monorepoRoot, "node_modules")];
// @gist/core's own dependencies resolve from this app's node_modules (core lives outside the app folder).
config.resolver.extraNodeModules = { "ts-fsrs": path.join(projectRoot, "node_modules/ts-fsrs") };
module.exports = config;
