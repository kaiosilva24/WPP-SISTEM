const { Client } = require('pg');

const client = new Client({
  user: 'admin',
  host: '129.80.149.224',
  database: 'postgres', // default db
  password: 'SecurePass_WhatsApp_2026!',
  port: 8080
});

async function check() {
  try {
    await client.connect();
    
    // 1. Get database sizes
    const sizeRes = await client.query(`
      SELECT datname as db_name, 
             pg_size_pretty(pg_database_size(datname)) as size_str,
             pg_database_size(datname) as size_bytes
      FROM pg_database 
      WHERE datistemplate = false;
    `);
    console.log(`\n=== DATABASES AND SIZES ===`);
    console.table(sizeRes.rows);

    // 2. Get active connections
    const connRes = await client.query(`
      SELECT datname, count(*) as active_connections 
      FROM pg_stat_activity 
      GROUP BY datname;
    `);
    console.log(`\n=== ACTIVE CONNECTIONS ===`);
    console.table(connRes.rows);

    // 3. System capabilities (pg version)
    const verRes = await client.query(`SELECT version();`);
    console.log(`\n=== POSTGRES VERSION ===`);
    console.log(verRes.rows[0].version);

  } catch (e) {
    console.error("Error connecting to 'postgres' DB. Trying without specifying DB...");
    
    // Try connecting to whatsapp_warming if postgres doesn't exist
    const fallbackClient = new Client({
      user: 'admin',
      host: '129.80.149.224',
      database: 'whatsapp_warming',
      password: 'SecurePass_WhatsApp_2026!',
      port: 8080
    });
    
    try {
        await fallbackClient.connect();
        const sizeRes = await fallbackClient.query(`
          SELECT datname as db_name, 
                 pg_size_pretty(pg_database_size(datname)) as size_str
          FROM pg_database 
          WHERE datistemplate = false;
        `);
        console.log(`\n=== DATABASES AND SIZES (Fallback) ===`);
        console.table(sizeRes.rows);
        await fallbackClient.end();
    } catch(err2) {
        console.error(err2);
    }
  } finally {
    await client.end();
  }
}

check();
