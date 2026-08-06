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

console.log(`[build-pkg] Building pi-agent-core for ${isCjs ? 'CJS' : 'ESM'} into ${outDir}/...`);

// Helper to run command
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`[build-pkg] Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

// 1. Compile TypeScript
const tsgoArgs = [
  '-p', 'tsconfig.build.json',
  '--outDir', outDir,
  '--module', moduleSystem,
  '--moduleResolution', 'bundler'
];
run('tsgo', tsgoArgs);

// 2. For CJS build, create package.json marking directory as CommonJS
if (isCjs) {
  const destPkgPath = path.join(__dirname, '..', outDir, 'package.json');
  fs.mkdirSync(path.dirname(destPkgPath), { recursive: true });
  fs.writeFileSync(destPkgPath, JSON.stringify({ type: 'commonjs' }, null, 2), 'utf8');
  console.log(`[build-pkg] Created package.json in ${outDir} marking it as CommonJS`);
}

console.log(`[build-pkg] Build complete for pi-agent-core (${outDir})!`);
