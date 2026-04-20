const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Inlined from @expo/cli multipart encoder — no external deps needed
function encodeMultipartMixed(fields) {
  const boundary = `formdata-${crypto.randomBytes(8).toString('hex')}`;
  const CRLF = '\r\n';
  let body = '';
  for (const field of fields) {
    body += `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="${field.name}"`;
    if (field.contentType) body += `${CRLF}Content-Type: ${field.contentType}`;
    body += `${CRLF}${CRLF}`;
    body += field.value + CRLF;
  }
  body += `--${boundary}--${CRLF}${CRLF}`;
  return { boundary, body };
}

const DIST_DIR = path.join(process.env.WORKSPACE_DIR || __dirname, 'dist');
const PROJECT_DIR = process.env.WORKSPACE_DIR || __dirname;
const PORT = parseInt(process.env.EXPO_STATIC_PORT || '8082', 10);

// Get installed Expo SDK version from node_modules (read-only, no require('expo'))
let EXPO_SDK_VERSION = '54.0.0';
try {
  EXPO_SDK_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules/expo/package.json'), 'utf8')).version;
} catch {}
const SDK_MAJOR = EXPO_SDK_VERSION.split('.')[0] + '.0.0';

// Get local IP
const LOCAL_IP = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i.family === 'IPv4' && !i.internal)?.address || 'localhost';

// Read metadata.json and app.json to build the manifest
let metadata = null;
let appJson = null;
try {
  metadata = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'metadata.json'), 'utf8'));
  appJson = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'app.json'), 'utf8'));
} catch (e) {
  console.warn('[serve-expo] Could not load metadata.json or app.json:', e.message);
}
const exp = appJson ? (appJson.expo || appJson) : {};

function getManifest(host, platform) {
  const platformMeta = metadata.fileMetadata[platform];
  if (!platformMeta) {
    throw new Error(`No metadata for platform: ${platform}. Did you export with -p ${platform}?`);
  }
  const bundlePath = platformMeta.bundle;
  const baseUrl = `http://${host}`;

  // Match Expo CLI dev server manifest exactly:
  // - assets: [] (empty, like the dev server — assets are embedded in bundle)
  // - expoGo config matches dev server format
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion: exp.runtimeVersion || `exposdk:${SDK_MAJOR}`,
    launchAsset: {
      key: 'bundle',
      contentType: 'application/javascript',
      url: `${baseUrl}/${bundlePath}`,
    },
    assets: [],
    metadata: {},
    extra: {
      eas: { projectId: exp.extra?.eas?.projectId },
      expoClient: {
        ...exp,
        sdkVersion: SDK_MAJOR,
        hostUri: host,
      },
      expoGo: {
        mainModuleName: 'index',
        debuggerHost: host,
        developer: { tool: 'expo-cli', projectRoot: __dirname },
        packagerOpts: { dev: false },
      },
      scopeKey: `@anonymous/${exp.slug}`,
    },
  };
}

const MIME_TYPES = {
  '.js': 'application/javascript',
  '.hbc': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveFile(filePath, res) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const protoVer = req.headers['expo-protocol-version'] || '-';
  console.log(`  ${req.method} ${url.pathname} [platform=${req.headers['expo-platform'] || '-'}, proto=${protoVer}]`);

  // Manifest endpoints
  if (['/', '/manifest', '/index.exp'].includes(url.pathname)) {
    if (!metadata || !appJson) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Native export not ready — dist/metadata.json missing' }));
      return;
    }

    const platform = req.headers['expo-platform'] || 'ios';

    let manifest;
    try {
      manifest = getManifest(req.headers.host, platform);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    const manifestJson = JSON.stringify(manifest);
    console.log(`  Manifest runtimeVersion: ${manifest.runtimeVersion}`);
    console.log(`  Manifest bundleUrl: ${manifest.launchAsset.url}`);

    const encoded = encodeMultipartMixed([
      {
        name: 'manifest',
        value: manifestJson,
        contentType: 'application/json',
      },
    ]);

    const bodyBuf = Buffer.from(encoded.body, 'utf-8');

    // Match Expo CLI dev server: always protocol version 0, explicit Content-Length
    res.writeHead(200, {
      'content-type': `multipart/mixed; boundary=${encoded.boundary}`,
      'content-length': bodyBuf.length,
      'expo-protocol-version': 0,
      'expo-sfv-version': 0,
      'cache-control': 'private, max-age=0',
    });
    res.end(bodyBuf);
    return;
  }

  // Status endpoint
  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('packager-status:running');
    return;
  }

  // Symbolicate endpoint
  if (url.pathname === '/symbolicate') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stack: [] }));
    return;
  }

  // Logs endpoint
  if (url.pathname === '/logs') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const decodedPath = decodeURIComponent(url.pathname);

  // 1. Try serving from dist/
  const distFilePath = path.join(DIST_DIR, decodedPath);
  if (distFilePath.startsWith(DIST_DIR) && serveFile(distFilePath, res)) {
    return;
  }

  // 2. Fallback: serve source assets from project root
  const projectFilePath = path.join(PROJECT_DIR, decodedPath);
  if (projectFilePath.startsWith(PROJECT_DIR) && serveFile(projectFilePath, res)) {
    console.log(`    -> served from project root`);
    return;
  }

  // 3. Try stripping leading /assets/ prefix
  if (decodedPath.startsWith('/assets/')) {
    const stripped = decodedPath.replace(/^\/assets\/\.?\/?/, '/');
    const strippedPath = path.join(PROJECT_DIR, stripped);
    if (strippedPath.startsWith(PROJECT_DIR) && serveFile(strippedPath, res)) {
      console.log(`    -> served from project root (stripped /assets/ prefix)`);
      return;
    }
  }

  console.log(`  404: ${decodedPath}`);
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  const expUrl = `exp://${LOCAL_IP}:${PORT}`;
  console.log(`\n  Expo dist/ server running! (SDK ${EXPO_SDK_VERSION})\n`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://${LOCAL_IP}:${PORT}`);
  console.log(`  Expo Go:  ${expUrl}`);
  console.log(`  Runtime:  exposdk:${SDK_MAJOR}\n`);

  try {
    require('qrcode-terminal').generate(expUrl, { small: true }, (qr) => {
      console.log(qr);
    });
  } catch {
    console.log(`  Scan this URL manually: ${expUrl}\n`);
  }
});
