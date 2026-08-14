const path = require('node:path');
const argon2 = require('argon2');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const existing = await client.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (!existing.rowCount) {
    const passwordHash = await argon2.hash(process.env.INITIAL_ADMIN_PASSWORD || 'Admin@12345');
    await client.query(
      `INSERT INTO users (full_name, email, phone_number, password_hash, role)
       VALUES ($1, $2, $3, $4, 'ADMIN')`,
      ['مدیر سامانه اتوماسیون', 'admin@automation.local', '09000000000', passwordHash],
    );
    console.log('Created admin@automation.local with the initial password Admin@12345.');
  } else {
    console.log('An administrator already exists; seed skipped.');
  }
  await client.end();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
