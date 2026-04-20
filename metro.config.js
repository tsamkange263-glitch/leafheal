const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);

// Inspector overlay — injected by build system (not part of template)
const inspectorPath = path.resolve(__dirname, 'inspector-overlay.js');
const hasInspector = fs.existsSync(inspectorPath);

// Web polyfills — injected by build system (mocks for expo-haptics, etc.)
const polyfillsPath = path.resolve(__dirname, 'webPolyfills.js');
const hasPolyfills = fs.existsSync(polyfillsPath);

// Disable minification for web builds
config.transformer = {
  ...config.transformer,
  minifierConfig: {
    compress: false,
    mangle: false,
  },
};

// Add support for resolving modules
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(__dirname),
  ],
  // Fix for react-native-svg module resolution
  sourceExts: [...(config.resolver.sourceExts || []), 'svg'],
  // Allow .wasm files to be resolved as assets (needed by expo-sqlite web)
  assetExts: [...(config.resolver.assetExts || []), 'wasm'],
  resolverMainFields: ['react-native', 'browser', 'main'],
};

// Configure Metro for proxy deployment
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Serve web polyfills script (file injected by build system)
      if (hasPolyfills && (req.url === '/__polyfills__' || (req.url && req.url.startsWith('/__polyfills__?')))) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(fs.readFileSync(polyfillsPath, 'utf8'));
        return;
      }

      // Serve inspector overlay script (file injected by build system)
      if (hasInspector && (req.url === '/__inspector__' || (req.url && req.url.startsWith('/__inspector__?')))) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(fs.readFileSync(inspectorPath, 'utf8'));
        return;
      }

      // Inject base path for proxy deployment
      const proxyPath = req.headers['x-forwarded-prefix'];
      if (proxyPath) {
        const originalSend = res.send;
        res.send = function(data) {
          if (typeof data === 'string' && data.includes('<head>')) {
            data = data.replace('<head>', `<head><base href="${proxyPath}/">`);
          }
          originalSend.call(this, data);
        };
      }
      return middleware(req, res, next);
    };
  },
};

// FASTSHOT_WEB_POLYFILLS_HOOK
module.exports = (() => {
  const helperPath = process.env.FASTSHOT_METRO_POLYFILL_HELPER;
  if (!helperPath) {
    return config;
  }

  try {
    const { withFastshotWebPolyfills } = require(helperPath);
    return withFastshotWebPolyfills(config, {
      polyfillsDir: process.env.FASTSHOT_WEB_POLYFILLS_DIR,
    });
  } catch (error) {
    console.warn('[Fastshot] Failed to apply web polyfills helper:', error);
    return config;
  }
})();
