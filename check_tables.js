const { Client } = require('pg');

async function listTables(dbName) {
  const client = new Client({
    user: 'admin',
    host: '129.80.149.224',
    database: dbName,
    password: 'SecurePass_WhatsApp_2026!',
    port: 8080
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log(`\n=== TABLES in ${dbName} ===`);
    const tables = res.rows.map(r => r.table_name);
    console.log(tables.join(', ') || '(no tables)');
  } catch (e) {
    console.error(`Error connecting to ${dbName}:`, e.message);
  } finally {
    await client.end();
  }
}

async function run() {
  await listTables('postgres');
  await listTables('whatsapp_warming');
}

run();
