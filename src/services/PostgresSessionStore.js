const fs = require('fs');
const path = require('path');

/**
 * PostgreSQL Store para RemoteAuth do whatsapp-web.js
 * Salva a sessão WhatsApp (ZIP) como BYTEA no PostgreSQL.
 * Assim, ao reiniciar o servidor (Discloud), a sessão é restaurada sem QR code.
 */
class PostgresSessionStore {
    constructor(pool) {
        this.pool = pool;
        this._initTable();
    }

    async _initTable() {
        const client = await this.pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS wwebjs_sessions (
                    session_id TEXT PRIMARY KEY,
                    session_data BYTEA NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            `);
        } catch (e) {
            console.error('[PostgresStore] Erro ao criar tabela wwebjs_sessions:', e.message);
        } finally {
            client.release();
        }
    }

    /**
     * Verifica se a sessão existe no banco
     * @param {{ session: string }} options
     * @returns {Promise<boolean>}
     */
    async sessionExists(options) {
        const client = await this.pool.connect();
        try {
            const res = await client.query(
                'SELECT 1 FROM wwebjs_sessions WHERE session_id = $1',
                [options.session]
            );
            const exists = res.rows.length > 0;
            console.log(`[PostgresStore] sessionExists(${options.session}): ${exists}`);
            return exists;
        } catch (e) {
            console.error('[PostgresStore] Erro em sessionExists:', e.message);
            return false;
        } finally {
            client.release();
        }
    }

    /**
     * Salva a sessão (lê o ZIP do disco e grava no PostgreSQL)
     * RemoteAuth chama save({ session: "/path/to/dataPath/RemoteAuth-{clientId}" })
     * O ZIP está em "{session}.zip"
     * @param {{ session: string }} options
     */
    async save(options) {
        const zipPath = `${options.session}.zip`;
        const client = await this.pool.connect();
        try {
            const data = fs.readFileSync(zipPath);
            const sessionId = path.basename(options.session);

            await client.query(
                `INSERT INTO wwebjs_sessions (session_id, session_data, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (session_id)
                 DO UPDATE SET session_data = $2, updated_at = NOW()`,
                [sessionId, data]
            );
            const sizeMB = (data.length / 1024 / 1024).toFixed(2);
            console.log(`[PostgresStore] Sessão '${sessionId}' salva no PostgreSQL (${sizeMB} MB)`);
        } catch (e) {
            console.error('[PostgresStore] Erro ao salvar sessão:', e.message);
        } finally {
            client.release();
        }
    }

    /**
     * Extrai a sessão (lê do PostgreSQL e escreve o ZIP no disco)
     * @param {{ session: string, path: string }} options
     */
    async extract(options) {
        const client = await this.pool.connect();
        try {
            const res = await client.query(
                'SELECT session_data FROM wwebjs_sessions WHERE session_id = $1',
                [options.session]
            );
            if (res.rows.length > 0) {
                fs.writeFileSync(options.path, res.rows[0].session_data);
                const sizeMB = (res.rows[0].session_data.length / 1024 / 1024).toFixed(2);
                console.log(`[PostgresStore] Sessão '${options.session}' restaurada do PostgreSQL (${sizeMB} MB)`);
            }
        } catch (e) {
            console.error('[PostgresStore] Erro ao extrair sessão:', e.message);
        } finally {
            client.release();
        }
    }

    /**
     * Deleta a sessão do PostgreSQL
     * @param {{ session: string }} options
     */
    async delete(options) {
        const client = await this.pool.connect();
        try {
            await client.query(
                'DELETE FROM wwebjs_sessions WHERE session_id = $1',
                [options.session]
            );
            console.log(`[PostgresStore] Sessão '${options.session}' deletada do PostgreSQL`);
        } catch (e) {
            console.error('[PostgresStore] Erro ao deletar sessão:', e.message);
        } finally {
            client.release();
        }
    }
}

module.exports = PostgresSessionStore;
