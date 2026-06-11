import pg from 'pg';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
for (const line of env.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) process.env[k.trim()] = v.join('=').trim();
}

void (async () => {
  const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await client.connect();
  const result = await client.query(`
    SELECT s.id, s.name, c.name AS competition
    FROM seasons s
    JOIN competitions c ON c.id = s.competition_id
    ORDER BY s.created_at DESC LIMIT 5
  `);
  console.log('\n=== SEASONS ===');
  for (const row of result.rows) {
    console.log(`SEASON_ID=${row.id}   ${row.competition} / ${row.name}`);
  }
  console.log('\nUso: $env:SEASON_ID="<id>"; npx tsx --env-file .env apps/etl/src/cron-live.ts\n');
  await client.end();
})();
