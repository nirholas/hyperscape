#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

// Common esbuild options
// Mark React and state management libraries as external to avoid duplicate instances
const commonOptions = {
  bundle: true,
  platform: 'browser',
  target: 'es2021',
  external: ['react', 'react-dom', 'zustand'],
  sourcemap: true,
  minify: !isWatch,
};

// Build main entry point
const mainBuildOptions = {
  ...commonOptions,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  format: 'esm',
};

// Build styled entry point (for backward compatibility, but consumers should prefer importing from main)
const styledBuildOptions = {
  ...commonOptions,
  entryPoints: ['src/styled/index.ts'],
  outfile: 'dist/styled/index.js',
  format: 'esm',
};

async function build() {
  console.log('Building hs-kit...');
  
  try {
    // Build ESM versions
    await esbuild.build(mainBuildOptions);
    await esbuild.build(styledBuildOptions);
    
    // Build CJS versions
    await esbuild.build({
      ...mainBuildOptions,
      outfile: 'dist/index.cjs',
      format: 'cjs',
    });
    await esbuild.build({
      ...styledBuildOptions,
      outfile: 'dist/styled/index.cjs',
      format: 'cjs',
    });
    
    // Generate type declarations
    console.log('Generating type declarations...');
    try {
      execSync('tsc --emitDeclarationOnly --declaration --declarationMap', {
        stdio: 'inherit',
      });
    } catch (e) {
      console.warn('Type declaration generation had warnings (continuing)');
    }
    
    console.log('Build complete!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

async function watch() {
  console.log('Watching hs-kit for changes...');
  
  const mainCtx = await esbuild.context(mainBuildOptions);
  const styledCtx = await esbuild.context(styledBuildOptions);
  
  await Promise.all([
    mainCtx.watch(),
    styledCtx.watch(),
  ]);
  
  console.log('Watching for changes...');
}

if (isWatch) {
  watch();
} else {
  build();
}
