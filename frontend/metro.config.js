// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require("path");

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// zustand 4.5 отдаёт по условию `import` ESM-сборку с `import.meta.env`.
// На нативе Metro берёт условие `react-native` и попадает в CJS, а на вебе —
// в `esm/*.mjs`; web-бандл подключается обычным <script>, поэтому движок падает
// на `Cannot use 'import.meta' outside a module` ещё до первого рендера — отсюда
// белый экран. Условиями это не лечится: Metro добавляет `import` сам, по виду
// импорта, поэтому подменяем путь на ту же CJS-сборку, что идёт в приложение.
const ZUSTAND_ROOT = path.dirname(require.resolve("zustand/package.json"));

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && (moduleName === "zustand" || moduleName.startsWith("zustand/"))) {
    const subpath = moduleName === "zustand" ? "index" : moduleName.slice("zustand/".length);
    return { type: "sourceFile", filePath: path.join(ZUSTAND_ROOT, `${subpath}.js`) };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
