import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { client as dbClient } from './db/connection.js';
import { createApp } from './app.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

const app = createApp();
const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`API docs: http://localhost:${PORT}/api/docs`);

  try {
    const tableCheck = await dbClient`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'users'
      LIMIT 1
    `;
    if (tableCheck.length === 0) {
      console.warn('Database tables missing. Run: npm run db:migrate && npm run db:seed');
    }
  } catch {
    console.warn('Could not verify database at startup');
  }
});
