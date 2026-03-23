const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');
const logger = require('../utils/logger');

/**
 * Adaptador de Autenticação para salvar chaves do Baileys no PostgreSQL
 * Mantém as contas ativas mesmo após restarts da Discloud.
 *
 * @param {string|number} accountId ID da conta do WhatsApp 
 * @param {object} dbManager Instância do DatabaseManager com pool do PG
 */
const usePostgresAuthState = async (accountId, dbManager) => {
    
    const writeData = async (data, keyId) => {
        try {
            const dataString = JSON.stringify(data, BufferJSON.replacer);
            // Salva na nova tabela baileys_auth
            await dbManager.pool.query(
                `INSERT INTO baileys_auth (account_id, key_id, data) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (account_id, key_id) 
                 DO UPDATE SET data = EXCLUDED.data`,
                [accountId, keyId, dataString]
            );
        } catch (err) {
            logger.error(`Account ${accountId}`, `[AUTH] Erro ao salvar key ${keyId}: ${err.message}`);
        }
    };

    const readData = async (keyId) => {
        try {
            const res = await dbManager.pool.query(
                `SELECT data FROM baileys_auth WHERE account_id = $1 AND key_id = $2`,
                [accountId, keyId]
            );
            if (res.rows.length > 0 && res.rows[0].data) {
                return JSON.parse(res.rows[0].data, BufferJSON.reviver);
            }
            return null;
        } catch (err) {
            logger.error(`Account ${accountId}`, `[AUTH] Erro ao ler key ${keyId}: ${err.message}`);
            return null;
        }
    };

    const removeData = async (keyId) => {
        try {
            await dbManager.pool.query(
                `DELETE FROM baileys_auth WHERE account_id = $1 AND key_id = $2`,
                [accountId, keyId]
            );
        } catch (err) {
            logger.error(`Account ${accountId}`, `[AUTH] Erro ao remover key ${keyId}: ${err.message}`);
        }
    };

    // Lê a raiz das credenciais (Creds)
    const credsData = await readData('creds');
    let creds = credsData || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        },
        clearState: async () => {
            try {
                logger.info(`Account ${accountId}`, `[AUTH] Apagando cache do banco para logout...`);
                await dbManager.pool.query(`DELETE FROM baileys_auth WHERE account_id = $1`, [accountId]);
            } catch (err) {
                logger.error(`Account ${accountId}`, `[AUTH] Erro ao apagar credenciais: ${err.message}`);
            }
        }
    };
};

module.exports = usePostgresAuthState;
