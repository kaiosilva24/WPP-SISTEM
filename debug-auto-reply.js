/**
 * Script de Debug para Auto-Reply
 * Verifica o estado completo do sistema de respostas automáticas
 *
 * Execute: node debug-auto-reply.js
 */

require('dotenv').config();
const db = require('./backend/src/database/DatabaseManager');

async function debug() {
    try {
        console.log('\n' + '='.repeat(70));
        console.log('🔍 DEBUG - VERIFICAÇÃO DE AUTO-REPLY');
        console.log('='.repeat(70) + '\n');

        // 1. Listar tenants
        console.log('📊 1. TENANTS\n');
        const tenants = await db.listTenants();
        console.log(`Tenants encontrados: ${tenants.length}`);
        for (const t of tenants) {
            console.log(`  - ${t.id}: ${t.name} (schema: ${t.schema_name})`);
        }

        // 2. Para cada tenant, verificar campanhas
        for (const tenant of tenants) {
            console.log(`\n📋 2. CAMPANHAS DO TENANT: ${tenant.name}\n`);

            const tdb = db.tenant(tenant.schema_name);
            const campaigns = await tdb.listCampaigns();
            console.log(`Campanhas encontradas: ${campaigns.length}`);

            for (const c of campaigns) {
                console.log(`\n  ┌─ ${c.name} (ID: ${c.id})`);
                console.log(`  │  Status: ${c.status}`);
                console.log(`  │  Auto-reply: ${c.auto_reply_enabled ? '✅ SIM' : '❌ NÃO'}`);
                console.log(`  │  Pausa após resposta: ${c.pause_on_reply_seconds}s`);

                // Verificar textos de resposta
                const replyTexts = await tdb.getCampaignTexts(c.id, 'reply');
                console.log(`  │  Textos de resposta: ${replyTexts.length}`);
                if (replyTexts.length > 0) {
                    replyTexts.slice(0, 2).forEach((t, i) => {
                        console.log(`  │    ${i + 1}. "${t.body.substring(0, 50)}..."`);
                    });
                }

                // Verificar contatos
                const counts = await tdb.getCampaignCounts(c.id);
                console.log(`  │  Contatos:`);
                console.log(`  │    - Pending: ${counts.pending || 0}`);
                console.log(`  │    - Sending: ${counts.sending || 0}`);
                console.log(`  │    - Sent: ${counts.sent || 0}`);
                console.log(`  │    - Replied: ${counts.replied || 0}`);
                console.log(`  │    - Failed: ${counts.failed || 0}`);

                // Verificar contatos em pausa
                const paused = await tdb.pool.query(
                    `SELECT COUNT(*) as count FROM ${tdb.schema}.dispatch_contacts
                     WHERE campaign_id = $1 AND pause_until > now()`,
                    [c.id]
                );
                console.log(`  │    - Em pausa: ${paused.rows[0].count || 0}`);

                console.log(`  └─\n`);
            }

            // 3. Verificar contas
            console.log(`\n👤 3. CONTAS DO TENANT: ${tenant.name}\n`);
            const accounts = await tdb.getAllAccounts();
            console.log(`Contas encontradas: ${accounts.length}`);

            for (const a of accounts) {
                console.log(`\n  ┌─ ${a.name} (ID: ${a.id})`);
                console.log(`  │  Status: ${a.status}`);
                console.log(`  │  Autenticado: ${a.whatsapp_id ? '✅ SIM' : '❌ NÃO'}`);
                console.log(`  │  Mensagens enviadas: ${a.messages_sent || 0}`);
                console.log(`  │  Mensagens recebidas: ${a.messages_received || 0}`);
                console.log(`  └─\n`);
            }
        }

        console.log('\n' + '='.repeat(70));
        console.log('✅ DEBUG CONCLUÍDO');
        console.log('='.repeat(70) + '\n');

        console.log('📝 PRÓXIMAS AÇÕES:');
        console.log('1. ✅ Auto-reply habilitado? Se não → ativar na campanha');
        console.log('2. ✅ Textos de resposta? Se não → adicionar textos na aba "Respostas"');
        console.log('3. ✅ Contatos em PENDING? Se não → rodar reset de pausas');
        console.log('4. ✅ Conta em status READY? Se não → reconectar');
        console.log('\n');

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        process.exit(1);
    }
}

debug();
