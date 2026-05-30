#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, copyFileSync } from 'fs';

console.log('Setting up Inwest App...\n');

if (!existsSync('frontend') || !existsSync('backend')) {
  console.error('Error: Run this script from the project root (frontend/ and backend/ required).');
  process.exit(1);
}

try {
  console.log('Installing frontend dependencies...');
  execSync('npm install', { cwd: 'frontend', stdio: 'inherit' });

  console.log('\nInstalling backend dependencies...');
  execSync('npm install', { cwd: 'backend', stdio: 'inherit' });

  const envExample = 'backend/.env.example';
  const envTarget = 'backend/.env';
  if (existsSync(envExample) && !existsSync(envTarget)) {
    copyFileSync(envExample, envTarget);
    console.log('\nCreated backend/.env from .env.example');
  }

  console.log('\nDependencies installed.');
  console.log('\nQuick start (Docker — recommended):');
  console.log('  docker compose up --build');
  console.log('\nOr local development:');
  console.log('  npm run db:migrate && npm run db:seed');
  console.log('  npm run dev');
  console.log('\nDemo login: demo@demo.com / Demo1234!');
  console.log('API docs: http://localhost:3001/api/docs');
} catch (error) {
  console.error('\nSetup failed:', error.message);
  process.exit(1);
}
