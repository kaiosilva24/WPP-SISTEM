const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
// dotenv will be loaded by index.js - DisCloud uses system env vars
const logger = require('../utils/logger'); // Ensure logger is available or handle referencing

/**
 * Gerenciador de banco de dados PostgreSQL
 */
class DatabaseManager {
  constructor() {
    // Fallback values for DisCloud (when .env doesn't load properly)
    const dbConfig = {
      user: process.env.DB_USER || 'admin',
      host: process.env.DB_HOST || '129.80.149.224',
      database: process.env.DB_NAME || 'whatsapp_warming',
      password: process.env.DB_PASS || 'SecurePass_WhatsApp_2026!',
      port: parseInt(process.env.DB_PORT) || 8080,
    };

    // DEBUG: Log configuration
    console.log('🔍 DATABASE CONFIG:');
    console.log('   HOST:', dbConfig.host);
    console.log('   PORT:', dbConfig.port);
    console.log('   USER:', dbConfig.user);
    console.log('   DB:', dbConfig.database);
    console.log('   PASS:', dbConfig.password ? '***SET***' : 'MISSING');

    this.pool = new Pool(dbConfig);

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
                    max_message_interval INTEGER DEFAULT 60000,
                    min_followup_read_delay INTEGER DEFAULT 3000,
                    max_followup_read_delay INTEGER DEFAULT 15000,
                    min_followup_typing_delay INTEGER DEFAULT 5000,
                    max_followup_typing_delay INTEGER DEFAULT 20000,
                    min_followup_response_delay INTEGER DEFAULT 10000,
                    max_followup_response_delay INTEGER DEFAULT 30000,
                    min_followup_interval INTEGER DEFAULT 30000,
                    max_followup_interval INTEGER DEFAULT 120000,
                    min_group_read_delay INTEGER DEFAULT 3000,
                    max_group_read_delay INTEGER DEFAULT 15000,
                    min_group_typing_delay INTEGER DEFAULT 5000,
                    max_group_typing_delay INTEGER DEFAULT 20000,
                    min_group_response_delay INTEGER DEFAULT 10000,
                    max_group_response_delay INTEGER DEFAULT 30000,
                    min_group_interval INTEGER DEFAULT 15000,
                    max_group_interval INTEGER DEFAULT 45000,
                    followup_audio_enabled BOOLEAN DEFAULT FALSE,
                    followup_min_recording_delay INTEGER DEFAULT 5000,
                    followup_max_recording_delay INTEGER DEFAULT 15000,
                    followup_media_enabled BOOLEAN DEFAULT TRUE,
                    followup_media_interval INTEGER DEFAULT 3,
                    group_audio_enabled BOOLEAN DEFAULT FALSE,
                    group_min_recording_delay INTEGER DEFAULT 5000,
                    group_max_recording_delay INTEGER DEFAULT 15000,
                    group_media_enabled BOOLEAN DEFAULT TRUE,
                    group_media_interval INTEGER DEFAULT 3,
                    followup_docs_enabled BOOLEAN DEFAULT FALSE,
                    followup_docs_interval INTEGER DEFAULT 5,
                    group_docs_enabled BOOLEAN DEFAULT FALSE,
                    group_docs_interval INTEGER DEFAULT 5,
                    ignore_probability INTEGER DEFAULT 20,
                    media_enabled BOOLEAN DEFAULT TRUE,
                    media_interval INTEGER DEFAULT 2,
                    pause_after_n_responses INTEGER DEFAULT 0,
                    pause_duration_minutes INTEGER DEFAULT 10,
                    auto_warm_enabled BOOLEAN DEFAULT FALSE,
                    auto_warm_idle_minutes INTEGER DEFAULT 10,
                    auto_warm_delay_min INTEGER DEFAULT 30,
                    auto_warm_delay_max INTEGER DEFAULT 120,
                    group_enabled BOOLEAN DEFAULT TRUE,
                    min_audio_listen_delay INTEGER DEFAULT 5000,
                    max_audio_listen_delay INTEGER DEFAULT 30000,
                    min_followup_audio_listen_delay INTEGER DEFAULT 5000,
                    max_followup_audio_listen_delay INTEGER DEFAULT 30000,
                    min_group_audio_listen_delay INTEGER DEFAULT 5000,
                    max_group_audio_listen_delay INTEGER DEFAULT 30000,
                    global_group_delay_minutes INTEGER DEFAULT 0,
                    global_private_delay_minutes INTEGER DEFAULT 0,
                    standby_enabled INTEGER DEFAULT 0,
                    standby_min_interval INTEGER DEFAULT 5,
                    standby_max_interval INTEGER DEFAULT 15,
                    standby_min_duration INTEGER DEFAULT 10,
                    standby_max_duration INTEGER DEFAULT 60,
                    standby_watch_status_enabled INTEGER DEFAULT 1,
                    standby_watch_status_prob INTEGER DEFAULT 70,
                    standby_watch_status_min_contacts INTEGER DEFAULT 1,
                    standby_watch_status_max_contacts INTEGER DEFAULT 4,
                    standby_watch_status_min_delay INTEGER DEFAULT 3,
                    standby_watch_status_max_delay INTEGER DEFAULT 8,
                    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

      // Adiciona colunas novas se já existir tabela (migracao segura)
      const newCols = [
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS pause_after_n_responses INTEGER DEFAULT 0`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS pause_duration_minutes INTEGER DEFAULT 10`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS auto_warm_enabled BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS auto_warm_idle_minutes INTEGER DEFAULT 10`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS auto_warm_delay_min INTEGER DEFAULT 30`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS auto_warm_delay_max INTEGER DEFAULT 120`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS group_enabled BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS min_audio_listen_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS max_audio_listen_delay INTEGER DEFAULT 30000`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS min_followup_audio_listen_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS max_followup_audio_listen_delay INTEGER DEFAULT 30000`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS min_group_audio_listen_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS max_group_audio_listen_delay INTEGER DEFAULT 30000`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS global_group_delay_minutes INTEGER DEFAULT 0`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS global_private_delay_minutes INTEGER DEFAULT 0`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_enabled INTEGER DEFAULT 0`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_min_interval INTEGER DEFAULT 5`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_max_interval INTEGER DEFAULT 15`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_min_duration INTEGER DEFAULT 10`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_max_duration INTEGER DEFAULT 60`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_enabled INTEGER DEFAULT 1`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_prob INTEGER DEFAULT 70`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_min_contacts INTEGER DEFAULT 1`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_max_contacts INTEGER DEFAULT 4`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_min_delay INTEGER DEFAULT 3`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_max_delay INTEGER DEFAULT 8`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS proxy_group_id TEXT`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS webhook_id INTEGER`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS scheduled_start_time TEXT`,
        `ALTER TABLE account_configs ADD COLUMN IF NOT EXISTS scheduled_end_time TEXT`
      ];
      for (const sql of newCols) {
        try { await client.query(sql); } catch (e) { /* coluna já existe */ }
      }

      // Tabela de webhooks
      await client.query(`
          CREATE TABLE IF NOT EXISTS webhooks (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              url TEXT NOT NULL,
              method TEXT DEFAULT 'GET',
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
                    -- Privado: por tipo
                    priv_text INTEGER DEFAULT 0,
                    priv_image INTEGER DEFAULT 0,
                    priv_audio INTEGER DEFAULT 0,
                    priv_sticker INTEGER DEFAULT 0,
                    -- Grupo: por tipo
                    group_text INTEGER DEFAULT 0,
                    group_image INTEGER DEFAULT 0,
                    group_audio INTEGER DEFAULT 0,
                    group_sticker INTEGER DEFAULT 0,
                    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

      // Migração segura: adiciona colunas de breakdown se ainda não existirem
      const statsNewCols = [
        `ALTER TABLE account_stats ADD COLUMN IF NOT EXISTS priv_text INTEGER DEFAULT 0`,
        `ALTER TABLE account_stats ADD COLUMN IF NOT EXISTS priv_image INTEGER DEFAULT 0`,
        `ALTER TABLE account_stats ADD COLUMN IF NOT EXISTS priv_audio INTEGER DEFAULT 0`,
        `ALTER TABLE account_stats ADD COLUMN IF NOT EXISTS priv_sticker INTEGER DEFAULT 0`,
        `ALTER TABLE account_stats ADD COLUMN IF NOT EXISTS group_text INTEGER DEFAULT 0`,
        `ALTER TABLE account_stats ADD COLUMN IF NOT EXISTS group_image INTEGER DEFAULT 0`,
        `ALTER TABLE account_stats ADD COLUMN IF NOT EXISTS group_audio INTEGER DEFAULT 0`,
        `ALTER TABLE account_stats ADD COLUMN IF NOT EXISTS group_sticker INTEGER DEFAULT 0`,
      ];
      for (const sql of statsNewCols) {
        try { await client.query(sql); } catch (e) { /* coluna já existe */ }
      }

      // Tabela de novos contatos
      await client.query(`
          CREATE TABLE IF NOT EXISTS new_contacts (
              id SERIAL PRIMARY KEY,
              account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
              phone_number TEXT NOT NULL,
              pushname TEXT,
              is_saved BOOLEAN DEFAULT FALSE,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(account_id, phone_number)
          )
      `);

      // Tabela de usuários do sistema (acesso ao dashboard)
      await client.query(`
          CREATE TABLE IF NOT EXISTS system_users (
              id SERIAL PRIMARY KEY,
              email TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

  // ==========================================
  // MÉTODOS - USUÁRIOS DO SISTEMA
  // ==========================================

  async createSystemUser(email, passwordHash, role = 'user') {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        'INSERT INTO system_users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at',
        [email.toLowerCase(), passwordHash, role]
      );
      return res.rows[0];
    } finally {
      client.release();
    }
  }

  async getSystemUserByEmail(email) {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        'SELECT * FROM system_users WHERE email = $1',
        [email.toLowerCase()]
      );
      return res.rows[0];
    } finally {
      client.release();
    }
  }

  async getAllSystemUsers() {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        'SELECT id, email, role, created_at FROM system_users ORDER BY created_at ASC'
      );
      return res.rows;
    } finally {
      client.release();
    }
  }

  async deleteSystemUser(id) {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        'DELETE FROM system_users WHERE id = $1 RETURNING id',
        [id]
      );
      return res.rowCount > 0;
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
      'min_response_delay', 'max_response_delay',
      'min_message_interval', 'max_message_interval',
      'min_followup_read_delay', 'max_followup_read_delay',
      'min_followup_typing_delay', 'max_followup_typing_delay',
      'min_followup_response_delay', 'max_followup_response_delay',
      'min_followup_interval', 'max_followup_interval',
      'min_group_read_delay', 'max_group_read_delay',
      'min_group_typing_delay', 'max_group_typing_delay',
      'min_group_response_delay', 'max_group_response_delay',
      'min_group_interval', 'max_group_interval',
      'followup_audio_enabled', 'followup_min_recording_delay', 'followup_max_recording_delay',
      'followup_media_enabled', 'followup_media_interval',
      'group_audio_enabled', 'group_min_recording_delay', 'group_max_recording_delay',
      'group_media_enabled', 'group_media_interval',
      'followup_docs_enabled', 'followup_docs_interval',
      'group_docs_enabled', 'group_docs_interval',
      'ignore_probability', 'media_enabled', 'media_interval',
      'pause_after_n_responses', 'pause_duration_minutes',
      'auto_warm_enabled', 'auto_warm_idle_minutes',
      'auto_warm_delay_min', 'auto_warm_delay_max',
      'group_enabled',
      'min_audio_listen_delay', 'max_audio_listen_delay',
      'min_followup_audio_listen_delay', 'max_followup_audio_listen_delay',
      'min_group_audio_listen_delay', 'max_group_audio_listen_delay',
      'global_group_delay_minutes', 'global_private_delay_minutes',
      'standby_enabled', 'standby_min_interval', 'standby_max_interval',
      'standby_min_duration', 'standby_max_duration',
      'standby_watch_status_enabled', 'standby_watch_status_prob',
      'standby_watch_status_min_contacts', 'standby_watch_status_max_contacts',
      'standby_watch_status_min_delay', 'standby_watch_status_max_delay',
      'proxy_group_id', 'webhook_id', 'scheduled_start_time', 'scheduled_end_time'
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

    // Breakdown por tipo/contexto (incremento atoômico)
    const incrCols = ['priv_text', 'priv_image', 'priv_audio', 'priv_sticker',
      'group_text', 'group_image', 'group_audio', 'group_sticker'];
    for (const col of incrCols) {
      if (stats[col] !== undefined) {
        fields.push(`${col} = ${col} + $${index++}`);
        values.push(stats[col]);
      }
    }

    fields.push('last_activity = CURRENT_TIMESTAMP');

    if (stats.uptime_start !== undefined) {
      fields.push(`uptime_start = $${index++}`);
      values.push(stats.uptime_start);
    }

    values.push(accountId);

    if (fields.length === 0) return;

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

  /**
   * Salva um novo contato para exportação futura via vCard
   */
  async saveNewContact(accountId, phoneNumber, pushname) {
    const client = await this.pool.connect();
    try {
      const sql = `
        INSERT INTO new_contacts (account_id, phone_number, pushname) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (account_id, phone_number) DO NOTHING
        RETURNING id
      `;
      const res = await client.query(sql, [accountId, phoneNumber, pushname]);
      return res.rows.length > 0 ? res.rows[0].id : null;
    } catch (error) {
      logger.error('Database', 'Erro ao salvar novo contato: ' + error.message);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Retorna a contagem de contatos não salvos agrupada por conta
   */
  async getUnsavedContactsCount() {
    const client = await this.pool.connect();
    try {
      const sql = `SELECT account_id, COUNT(*) as count FROM new_contacts WHERE is_saved = FALSE GROUP BY account_id`;
      const res = await client.query(sql);
      const counts = {};
      for (const row of res.rows) {
        counts[row.account_id] = parseInt(row.count);
      }
      return counts;
    } catch (error) {
      logger.error('Database', 'Erro ao buscar contagens de contatos: ' + error.message);
      return {};
    } finally {
      client.release();
    }
  }

  /**
   * Obtém os contatos não salvos de uma conta específica para gerar o vCard
   */
  async getUnsavedContacts(accountId) {
    const client = await this.pool.connect();
    try {
      const sql = `SELECT * FROM new_contacts WHERE account_id = $1 AND is_saved = FALSE ORDER BY created_at ASC`;
      const res = await client.query(sql, [accountId]);
      return res.rows;
    } catch (error) {
      logger.error('Database', 'Erro ao buscar contatos não salvos: ' + error.message);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Marca os contatos como salvos (após download do vCard)
   */
  async markContactsAsSaved(accountId) {
    const client = await this.pool.connect();
    try {
      const sql = `UPDATE new_contacts SET is_saved = TRUE WHERE account_id = $1 AND is_saved = FALSE`;
      await client.query(sql, [accountId]);
      return true;
    } catch (error) {
      logger.error('Database', 'Erro ao marcar contatos como salvos: ' + error.message);
      return false;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // METODOS - WEBHOOKS E AGENDAMENTO
  // ==========================================

  async getAllWebhooks() {
    const client = await this.pool.connect();
    try {
      const res = await client.query('SELECT * FROM webhooks ORDER BY id ASC');
      return res.rows;
    } finally {
      client.release();
    }
  }

  async getWebhook(id) {
    const client = await this.pool.connect();
    try {
      const res = await client.query('SELECT * FROM webhooks WHERE id = $1', [id]);
      return res.rows[0];
    } finally {
      client.release();
    }
  }

  async createWebhook(name, url, method = 'GET') {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        'INSERT INTO webhooks (name, url, method) VALUES ($1, $2, $3) RETURNING *',
        [name, url, method]
      );
      return res.rows[0];
    } finally {
      client.release();
    }
  }

  async updateWebhook(id, data) {
    const client = await this.pool.connect();
    try {
      const updates = [];
      const values = [];
      let i = 1;

      for (const [key, value] of Object.entries(data)) {
        if (['name', 'url', 'method'].includes(key)) {
          updates.push(`${key} = $${i}`);
          values.push(value);
          i++;
        }
      }

      if (updates.length === 0) return null;

      values.push(id);
      const query = `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`;
      const res = await client.query(query, values);
      return res.rows[0];

    } finally {
      client.release();
    }
  }

  async deleteWebhook(id) {
    const client = await this.pool.connect();
    try {
      const res = await client.query('DELETE FROM webhooks WHERE id = $1 RETURNING *', [id]);

      // Limpa qualquer configuração de conta que apontava para esse webhook
      await client.query('UPDATE account_configs SET webhook_id = NULL WHERE webhook_id = $1', [id]);

      return res.rowCount > 0;
    } finally {
      client.release();
    }
  }
}

// Singleton
const dbManager = new DatabaseManager();

module.exports = dbManager;
