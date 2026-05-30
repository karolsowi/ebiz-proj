#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envExamplePath = path.join(__dirname, '..', '.env.example');
const envPath = path.join(__dirname, '..', '.env');

console.log('🚀 Setting up environment variables...\n');

// Check if .env already exists
if (fs.existsSync(envPath)) {
  console.log('✅ .env file already exists!');
  console.log('📝 Your environment variables are configured.');
  console.log('💡 If you need to update them, edit the .env file directly.');
} else {
  console.log('📄 .env file not found. Creating from template...');
  
  // Check if .env.example exists to create .env from it
  if (!fs.existsSync(envExamplePath)) {
    console.error('❌ .env.example file not found!');
    console.error('💡 Please create a .env file manually with your environment variables.');
    process.exit(1);
  }

  // Read the example file
  const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');

  // Create .env file from example
  try {
    fs.writeFileSync(envPath, envExampleContent);
    console.log('✅ .env file created successfully from .env.example!');
    console.log('📝 Please edit .env and add your actual API keys and database URL.');
  } catch (error) {
    console.error('❌ Failed to create .env file:', error.message);
    process.exit(1);
  }
}

console.log('\n🎉 Environment setup complete!');
console.log('💡 Run "npm run dev" to start the development server.'); 