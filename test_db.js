require('dotenv').config();
const db = require('./src/database/DatabaseManager');

async function test() {
    try {
        const accounts = await db.getAllAccounts();
        console.log(accounts.map(a => ({ id: a.id, name: a.name, status: a.status })));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
test();
