const { Client } = require('pg');

const client = new Client({
  user: 'admin',
  host: '129.80.149.224',
  database: 'postgres', // Conectamos no básico só para criar o novo
  password: 'SecurePass_WhatsApp_2026!',
  port: 8080
});

async function createNewDatabase() {
  try {
    await client.connect();
    
    // Devolve se o banco já existir antes de criar
    const res = await client.query("SELECT datname FROM pg_database WHERE datname='sistema_financeiro_pessoal'");
    
    if (res.rows.length === 0) {
      // O comando de criar não pode ser atrelado a transações em algumas versões
      await client.query("CREATE DATABASE sistema_financeiro_pessoal;");
      console.log("✅ Banco de dados 'sistema_financeiro_pessoal' criado com sucesso de forma totalmente isolada!");
    } else {
      console.log("ℹ️ O banco de dados 'sistema_financeiro_pessoal' já existia!");
    }

  } catch (e) {
    console.error("❌ ERRO:", e.message);
  } finally {
    await client.end();
  }
}

createNewDatabase();
