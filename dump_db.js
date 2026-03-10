const db = require('./src/database/DatabaseManager');
async function run() {
    const accounts = await db.getAllAccounts();
    const webhooks = await db.getAllWebhooks();
    console.log('--- WEBHOOKS ---');
    console.log(webhooks);
    console.log('--- ACCOUNTS WITH PROXIES ---');
    accounts.filter(a => a.proxy_ip).forEach(a => {
        console.log(`Account ${a.id} (${a.name}): proxy=${a.proxy_ip}:${a.proxy_port} webhook_id=${a.webhook_id} proxy_group_id=${a.proxy_group_id}`);
    });
    process.exit(0);
}
run();
