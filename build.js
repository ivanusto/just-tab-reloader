const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(__dirname, 'dist');
const chromeDir = path.join(distDir, 'chrome');
const firefoxDir = path.join(distDir, 'firefox');

// Files and directories to include
const includeItems = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'utils.js',
  'icons',
  '_locales'
];

// 單一版本來源：package.json。建置時同步寫入兩個 manifest，避免版本號漂移。
const pkgVersion = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8')).version;

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(function(childItemName) {
      copyRecursiveSync(path.join(src, childItemName),
                        path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Clean dist
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}

// Create directories
fs.mkdirSync(chromeDir, { recursive: true });
fs.mkdirSync(firefoxDir, { recursive: true });

// Copy files
includeItems.forEach(item => {
  const srcPath = path.join(srcDir, item);
  if (fs.existsSync(srcPath)) {
    copyRecursiveSync(srcPath, path.join(chromeDir, item));
    copyRecursiveSync(srcPath, path.join(firefoxDir, item));
  }
});

// Sync version into the Chrome manifest from package.json
const chromeManifestPath = path.join(chromeDir, 'manifest.json');
const chromeManifest = JSON.parse(fs.readFileSync(chromeManifestPath, 'utf8'));
chromeManifest.version = pkgVersion;
fs.writeFileSync(chromeManifestPath, JSON.stringify(chromeManifest, null, 2));

// Modify Firefox manifest
const firefoxManifestPath = path.join(firefoxDir, 'manifest.json');
const manifestData = JSON.parse(fs.readFileSync(firefoxManifestPath, 'utf8'));

// 0. Sync version from package.json
manifestData.version = pkgVersion;

// 1. Add browser_specific_settings for Gecko
manifestData.browser_specific_settings = {
  gecko: {
    id: "just-tab-reloader@ivanusto.gmail.com", // You can change this to your actual add-on ID
    strict_min_version: "142.0",
    data_collection_permissions: {
      required: ["none"]
    }
  }
};

// 2. Convert service_worker to scripts for Firefox to avoid the warning.
//    Firefox event pages have no importScripts, so utils.js must be listed
//    explicitly before background.js.
if (manifestData.background && manifestData.background.service_worker) {
  manifestData.background.scripts = ["utils.js", manifestData.background.service_worker];
  delete manifestData.background.service_worker;
}

fs.writeFileSync(firefoxManifestPath, JSON.stringify(manifestData, null, 2));

console.log('Build completed! Chrome and Firefox versions are in the "dist" folder.');
