#!/usr/bin/env node
/**
 * Build script for test WASM fixtures
 *
 * Uses jco componentize to compile JavaScript test modules
 * into WASM components.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const srcDir = join(__dirname, 'src');
const witDir = join(__dirname, 'wit');
const wasmDir = join(__dirname, 'wasm');

// Ensure output directory exists
if (!existsSync(wasmDir)) {
  mkdirSync(wasmDir, { recursive: true });
}

// Get all source files
const sourceFiles = readdirSync(srcDir).filter((f) => f.endsWith('.js'));

console.log('Building test fixtures...\n');

for (const srcFile of sourceFiles) {
  const baseName = srcFile.replace('.js', '');
  const srcPath = join(srcDir, srcFile);
  const witPath = join(witDir, `${baseName}.wit`);
  const wasmPath = join(wasmDir, `${baseName}.wasm`);

  // Check if WIT file exists
  if (!existsSync(witPath)) {
    console.log(`  Skipping ${srcFile} - no WIT file found`);
    continue;
  }

  console.log(`  Building ${baseName}...`);

  try {
    // Use jco componentize to build the component
    // Note: This requires the WASI interfaces to be available
    execSync(
      `npx jco componentize ${srcPath} --wit ${witPath} -o ${wasmPath}`,
      {
        stdio: 'pipe',
        cwd: __dirname,
      }
    );
    console.log(`    ✓ ${wasmPath}`);
  } catch (error) {
    console.error(`    ✗ Failed to build ${baseName}:`);
    console.error(`      ${error.stderr?.toString() || error.message}`);
  }
}

console.log('\nBuild complete.');
