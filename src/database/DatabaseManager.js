const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const logger = require('../utils/logger'); // Ensure logger is available or handle referencing

/**
 * Gerenciador de banco de dados PostgreSQL
 */
class DatabaseManager {
  constructor() {
    this.pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASS,
      port: process.env.DB_PORT || 5432,
    });

    this.pool.on('error', (err, client) => {
      console.error('Unexpected error on idle client', err);
      // Don't exit process, just log
    });

    // Inicializa tabelas deve ser chamado explicitamente
  }

  /**
   * Inicializa tabelas
   */
  async initTables() {
    const client = await this.pool.connect();
    try {
      // Tabela de contas
      await client.query(`
                CREATE TABLE IF NOT EXISTS accounts (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL,
                    status TEXT DEFAULT 'disconnected',
                    phone_number TEXT,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            `);

      // Tabela de configurações de conta
      await client.query(`
                CREATE TABLE IF NOT EXISTS account_configs (
                    account_id INTEGER PRIMARY KEY,
                    proxy_enabled BOOLEAN DEFAULT FALSE,
                    proxy_ip TEXT,
                    proxy_port INTEGER,
                    proxy_username TEXT,
                    proxy_password TEXT,
                    min_read_delay INTEGER DEFAULT 3000,
                    max_read_delay INTEGER DEFAULT 15000,
                    min_typing_delay INTEGER DEFAULT 5000,
                    max_typing_delay INTEGER DEFAULT 20000,
                    min_response_delay INTEGER DEFAULT 10000,
                    max_response_delay INTEGER DEFAULT 30000,
                    min_message_interval INTEGER DEFAULT 20000,
                    ignore_probability INTEGER DEFAULT 20,
                    media_enabled BOOLEAN DEFAULT TRUE,
                    media_interval INTEGER DEFAULT 2,
                    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

      // Tabela de mensagens personalizadas
      await client.query(`
                CREATE TABLE IF NOT EXISTS account_messages (
                    id SERIAL PRIMARY KEY,
                    account_id INTEGER NOT NULL,
                    message_type TEXT NOT NULL, -- 'first', 'followup', 'group'
                    message_text TEXT NOT NULL,
                    enabled BOOLEAN DEFAULT TRUE,
                    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

      // Tabela de estatísticas
      await client.query(`
                CREATE TABLE IF NOT EXISTS account_stats (
                    account_id INTEGER PRIMARY KEY,
                    messages_sent INTEGER DEFAULT 0,
                    messages_received INTEGER DEFAULT 0,
                    unique_contacts INTEGER DEFAULT 0,
                    last_activity TIMESTAMPTZ,
                    uptime_start TIMESTAMPTZ,
                    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

      console.log('✅ Database tables initialized (PostgreSQL)');
    } catch (error) {
      console.error('❌ Error initializing tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cria uma nova conta
   */
  async createAccount(name) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query('INSERT INTO accounts (name) VALUES ($1) RETURNING *', [name]);
      const account = res.rows[0];

      // Cria configuração padrão
      await client.query('INSERT INTO account_configs (account_id) VALUES ($1)', [account.id]);

      // Cria estatísticas
      await client.query('INSERT INTO account_stats (account_id) VALUES ($1)', [account.id]);

      await client.query('COMMIT');
      return this.getAccount(account.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtém uma conta por ID
   */
  async getAccount(id) {
    const res = await this.pool.query(`
            SELECT a.*, c.*, s.*
            FROM accounts a
            LEFT JOIN account_configs c ON a.id = c.account_id
            LEFT JOIN account_stats s ON a.id = s.account_id
            WHERE a.id = $1
        `, [id]);
    return res.rows[0];
  }

  /**
   * Obtém uma conta por nome
   */
  async getAccountByName(name) {
    const res = await this.pool.query(`
            SELECT a.*, c.*, s.*
            FROM accounts a
            LEFT JOIN account_configs c ON a.id = c.account_id
            LEFT JOIN account_stats s ON a.id = s.account_id
            WHERE a.name = $1
        `, [name]);
    return res.rows[0];
  }

  /**
   * Obtém todas as contas
   */
  async getAllAccounts() {
    const res = await this.pool.query(`
            SELECT a.*, c.*, s.*
            FROM accounts a
            LEFT JOIN account_configs c ON a.id = c.account_id
            LEFT JOIN account_stats s ON a.id = s.account_id
            ORDER BY a.created_at DESC
        `);
    return res.rows;
  }

  /**
   * Atualiza status da conta
   */
  async updateAccountStatus(id, status, phoneNumber = null) {
    await this.pool.query(`
            UPDATE accounts 
            SET status = $1, phone_number = COALESCE($2, phone_number), updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [status, phoneNumber, id]);
  }

  /**
   * Atualiza configuração da conta
   */
  async updateAccountConfig(id, config) {
    const fields = [];
    const values = [];
    let index = 1;

    const allowedFields = [
      'proxy_enabled', 'proxy_ip', 'proxy_port', 'proxy_username', 'proxy_password',
      'min_read_delay', 'max_read_delay', 'min_typing_delay', 'max_typing_delay',
      'min_response_delay', 'max_response_delay', 'min_message_interval',
      'ignore_probability', 'media_enabled', 'media_interval'
    ];

    for (const field of allowedFields) {
      if (config[field] !== undefined) {
        fields.push(`${field} = $${index++}`);
        values.push(config[field]);
      }
    }

    if (fields.length === 0) return;

    values.push(id);
    await this.pool.query(`
            UPDATE account_configs SET ${fields.join(', ')} WHERE account_id = $${index}
        `, values);
  }

  /**
   * Adiciona mensagem personalizada
   */
  async addAccountMessage(accountId, messageType, messageText) {
    const res = await this.pool.query(`
            INSERT INTO account_messages (account_id, message_type, message_text)
            VALUES ($1, $2, $3)
            RETURNING id
        `, [accountId, messageType, messageText]);
    return { lastInsertRowid: res.rows[0].id }; // Maintain compatibility shape if needed, or just return ID
  }

  /**
   * Obtém mensagens da conta
   */
  async getAccountMessages(accountId, messageType = null) {
    let query = 'SELECT * FROM account_messages WHERE account_id = $1 AND enabled = TRUE';
    const params = [accountId];

    if (messageType) {
      query += ' AND message_type = $2';
      params.push(messageType);
    }

    const res = await this.pool.query(query, params);
    return res.rows;
  }

  /**
   * Remove mensagem
   */
  async deleteAccountMessage(id) {
    await this.pool.query('DELETE FROM account_messages WHERE id = $1', [id]);
  }

  /**
   * Atualiza estatísticas
   */
  async updateStats(accountId, stats) {
    const fields = [];
    const values = [];
    let index = 1;

    if (stats.messages_sent !== undefined) {
      fields.push(`messages_sent = messages_sent + $${index++}`);
      values.push(stats.messages_sent);
    }

    if (stats.messages_received !== undefined) {
      fields.push(`messages_received = messages_received + $${index++}`);
      values.push(stats.messages_received);
    }

    if (stats.unique_contacts !== undefined) {
      fields.push(`unique_contacts = $${index++}`);
      values.push(stats.unique_contacts);
    }

    fields.push('last_activity = CURRENT_TIMESTAMP');

    if (stats.uptime_start !== undefined) {
      fields.push(`uptime_start = $${index++}`);
      values.push(stats.uptime_start);
    }

    values.push(accountId);

    if (fields.length === 0) return; // Should likely process last_activity still? Original code implied so.
    // Actually original updated last_activity unconditionally.

    await this.pool.query(`
            UPDATE account_stats SET ${fields.join(', ')} WHERE account_id = $${index}
        `, values);
  }

  /**
   * Deleta uma conta
   */
  async deleteAccount(id) {
    await this.pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  }

  /**
   * Fecha conexão
   */
  async close() {
    await this.pool.end();
  }
}

// Singleton
const dbManager = new DatabaseManager();

module.exports = dbManager;
