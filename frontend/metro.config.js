
const path = require("path");

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const ZUSTAND_ROOT = path.dirname(require.resolve("zustand/package.json"));

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && (moduleName === "zustand" || moduleName.startsWith("zustand/"))) {
    const subpath = moduleName === "zustand" ? "index" : moduleName.slice("zustand/".length);
    return { type: "sourceFile", filePath: path.join(ZUSTAND_ROOT, `${subpath}.js`) };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
