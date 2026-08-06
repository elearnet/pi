const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isCjs = process.argv.includes('--cjs');
const isEsm = process.argv.includes('--esm');

if (!isCjs && !isEsm) {
  console.error('[build-pkg] Please specify either --cjs or --esm');
  process.exit(1);
}

const outDir = isCjs ? 'lib-commonjs' : 'lib';
const moduleSystem = isCjs ? 'commonjs' : 'esnext';

console.log(`[build-pkg] Building for ${isCjs ? 'CJS' : 'ESM'} into ${outDir}/...`);

// Helper to run command
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`[build-pkg] Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

// 1. Generate models
run('node', [path.join(__dirname, 'generate-models.ts'), '--strict']);

// 2. Check model data
run('node', [path.join(__dirname, 'check-model-data.ts')]);

// 3. Compile ts
const tsgoArgs = [
  '-p', 'tsconfig.build.json',
  '--outDir', outDir,
  '--module', moduleSystem,
  '--moduleResolution', 'bundler'
];
run('tsgo', tsgoArgs);

// 4. Copy data assets
const destDataDir = path.join(__dirname, '..', outDir, 'providers', 'data');
const srcDataDir = path.join(__dirname, '..', 'src', 'providers', 'data');

if (fs.existsSync(destDataDir)) {
  fs.rmSync(destDataDir, { recursive: true, force: true });
}

if (fs.existsSync(srcDataDir)) {
  fs.mkdirSync(destDataDir, { recursive: true });
  // Copy files recursively
  function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  copyDir(srcDataDir, destDataDir);
  console.log(`[build-pkg] Copied providers/data to ${destDataDir}`);
}

console.log(`[build-pkg] Build complete for ${outDir}!`);
