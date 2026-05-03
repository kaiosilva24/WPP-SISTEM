const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

/**
 * Auth state persistido em Postgres (tabela `<schema>.whatsapp_auth`).
 * Substitui o `useMultiFileAuthState` mantendo a mesma interface esperada
 * por `makeWASocket({ auth: state })`.
 *
 * Layout da tabela:
 *   account_id INT, type TEXT, key_id TEXT, value JSONB, PK(account_id,type,key_id)
 *
 * - type='creds', key_id='creds' -> linha única com os credentials
 * - type='<keyType>', key_id='<id>' -> chaves auxiliares (pre-key, session, sender-key, etc.)
 */
async function usePostgresAuthState(tdb, accountId) {
    async function readData(type, keyId) {
        const r = await tdb._run(
            'SELECT value FROM whatsapp_auth WHERE account_id = $1 AND type = $2 AND key_id = $3',
            [accountId, type, keyId]
        );
        if (!r.rows[0]) return null;
        const raw = typeof r.rows[0].value === 'string' ? r.rows[0].value : JSON.stringify(r.rows[0].value);
        return JSON.parse(raw, BufferJSON.reviver);
    }

    async function writeData(type, keyId, data) {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await tdb._run(
            `INSERT INTO whatsapp_auth (account_id, type, key_id, value, updated_at)
             VALUES ($1,$2,$3,$4::jsonb, now())
             ON CONFLICT (account_id, type, key_id)
             DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
            [accountId, type, keyId, json]
        );
    }

    async function removeData(type, keyId) {
        await tdb._run(
            'DELETE FROM whatsapp_auth WHERE account_id = $1 AND type = $2 AND key_id = $3',
            [accountId, type, keyId]
        );
    }

    const creds = (await readData('creds', 'creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const out = {};
                    await Promise.all(ids.map(async (id) => {
                        let val = await readData(type, id);
                        if (type === 'app-state-sync-key' && val) {
                            val = proto.Message.AppStateSyncKeyData.fromObject(val);
                        }
                        if (val) out[id] = val;
                    }));
                    return out;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            tasks.push(value ? writeData(category, id, value) : removeData(category, id));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', 'creds', creds);
        },
        clearAll: async () => {
            await tdb._run('DELETE FROM whatsapp_auth WHERE account_id = $1', [accountId]);
        }
    };
}

module.exports = { usePostgresAuthState };
