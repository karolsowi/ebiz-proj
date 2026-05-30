import { routeCatalog } from './routeCatalog.js';

function authLabel(auth: string): string {
  switch (auth) {
    case 'none':
      return 'No';
    case 'jwt':
      return 'JWT';
    case 'jwt-admin':
      return 'JWT (admin)';
    default:
      return auth;
  }
}

export function catalogToMarkdown(): string {
  const lines: string[] = [
    '# API reference (all mounted endpoints)',
    '',
    'Auto-generated from `backend/src/openapi/routeCatalog.ts`.',
    'Regenerate: `npm run docs:api`. Index: [README.md](README.md).',
    '',
    'Interactive Swagger UI: http://localhost:3001/api/docs',
    '',
    'OpenAPI JSON: http://localhost:3001/api/openapi.json',
    '',
    '**Auth:** send `Authorization: Bearer <accessToken>` from `POST /api/auth/login`.',
    '',
    '**Demo user (Docker seed):** `demo@demo.com` / `Demo1234!`',
    '',
    '| Method | Path | Auth | Description |',
    '|--------|------|------|-------------|',
  ];

  for (const entry of routeCatalog) {
    const method = entry.method.toUpperCase();
    const desc = entry.notes ? `${entry.summary} — ${entry.notes}` : entry.summary;
    lines.push(`| ${method} | \`${entry.path}\` | ${authLabel(entry.auth)} | ${desc} |`);
  }

  lines.push('');
  lines.push('## Example: login and list portfolio');
  lines.push('');
  lines.push('```bash');
  lines.push('curl -s -X POST http://localhost:3001/api/auth/login \\');
  lines.push('  -H "Content-Type: application/json" \\');
  lines.push('  -d \'{"email":"demo@demo.com","password":"Demo1234!"}\'');
  lines.push('');
  lines.push('# Use accessToken from response:');
  lines.push('curl -s http://localhost:3001/api/portfolio \\');
  lines.push('  -H "Authorization: Bearer <accessToken>"');
  lines.push('```');
  lines.push('');
  lines.push('## Integrations & paper trading');
  lines.push('');
  lines.push(
    '- **Paper trading only** — Alpaca routes target the paper API; see [INTEGRATIONS.md](INTEGRATIONS.md#paper-trading-only-current-setup).'
  );
  lines.push(
    '- **Per-user keys** — `GET /api/user/integrations` returns `canUseAlpaca`, `canManageReddit`, `canFetchNews`.'
  );
  lines.push(
    '- **Shared read-only data** — Reddit/News GET routes use stored PostgreSQL data without the caller’s provider keys; `POST /api/reddit/fetch`, `POST /api/news/refresh`, etc. require the caller’s keys in `user_api_keys`.'
  );
  lines.push('');
  lines.push('## HTTP status codes');
  lines.push('');
  lines.push('**200**, **201**, **400**, **401**, **403**, **404**, **422**, **500**');
  lines.push('');
  lines.push('Missing integration keys often return **400** with `code: INTEGRATION_KEYS_MISSING`.');
  lines.push('');

  return lines.join('\n');
}
