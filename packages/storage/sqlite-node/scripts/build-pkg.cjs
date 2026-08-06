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

console.log(`[build-pkg] Building sqlite-node for ${isCjs ? 'CJS' : 'ESM'} into ${outDir}/...`);

// Helper to run command
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`[build-pkg] Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

// Helper to find files recursively
function getFiles(dir, ext) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(file, ext));
    } else if (file.endsWith(ext)) {
      results.push(file);
    }
  });
  return results;
}

// Helper to recursively find and replace import.meta.url in CJS files
function replaceImportMeta(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replaceImportMeta(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('import.meta.url')) {
        content = content.replace(/import\.meta\.url/g, 'require("url").pathToFileURL(__filename).href');
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`[build-pkg] Injected CJS import.meta.url fallback in: ${path.relative(path.join(__dirname, '..'), fullPath)}`);
      }
    }
  }
}

// 1. Compile TypeScript and generate declarations
if (isEsm) {
  // ESM build is compiled directly via tsgo
  const tsgoArgs = [
    '-p', 'tsconfig.build.json',
    '--outDir', outDir,
    '--module', 'esnext',
    '--moduleResolution', 'bundler'
  ];
  run('tsgo', tsgoArgs);
} else {
  // CJS build has import.meta which TS compiler blocks under CJS format (TS1343).
  // Workaround:
  // 1. First, make sure the ESM lib/ directory is compiled. (If not built, compile it on the fly)
  const esmLibDir = path.join(__dirname, '..', 'lib');
  if (!fs.existsSync(esmLibDir) || getFiles(esmLibDir, '.js').length === 0) {
    console.log('[build-pkg] ESM build not found in lib/. Compiling ESM first to source CJS build...');
    const tsgoArgs = [
      '-p', 'tsconfig.build.json',
      '--outDir', 'lib',
      '--module', 'esnext',
      '--moduleResolution', 'bundler'
    ];
    run('tsgo', tsgoArgs);
  }

  // 2. Emit CJS declaration types (.d.ts) using tsgo with esnext module format (which allows import.meta)
  const tsgoArgs = [
    '-p', 'tsconfig.build.json',
    '--outDir', outDir,
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--emitDeclarationOnly'
  ];
  run('tsgo', tsgoArgs);

  // 3. Transpile the ESM JS files in lib/ to CJS in lib-commonjs/ using esbuild (which transpiles import.meta and rewrites extensions)
  const esbuild = require('esbuild');
  const esmJsFiles = getFiles(esmLibDir, '.js');
  esbuild.buildSync({
    entryPoints: esmJsFiles,
    outdir: outDir,
    outbase: 'lib',
    format: 'cjs',
    platform: 'node',
    logLevel: 'error'
  });

  // 4. Post-process CJS output files to replace import.meta.url with node-safe equivalent
  replaceImportMeta(path.join(__dirname, '..', outDir));

  // 5. Create package.json marking directory as CommonJS
  fs.writeFileSync(path.join(__dirname, '..', outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2), 'utf8');
  console.log(`[build-pkg] Created package.json in ${outDir} marking it as CommonJS`);
}

// 2. Copy migrations
const packageRoot = path.join(__dirname, '..');
const srcMigrations = path.join(packageRoot, 'src/sqlite/migrations');
const destMigrations = path.join(packageRoot, outDir, 'sqlite/migrations');

if (fs.existsSync(srcMigrations)) {
  fs.mkdirSync(destMigrations, { recursive: true });
  // Helper to copy files recursively
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
  copyDir(srcMigrations, destMigrations);
  console.log(`[build-pkg] Copied SQLite migrations to ${destMigrations}`);
}

console.log(`[build-pkg] Build complete for sqlite-node (${outDir})!`);
