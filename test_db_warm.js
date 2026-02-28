const db = require('./src/database/DatabaseManager');

async function check() {
    await db.init();
    const msgs01 = await db.getAccountMessages('01', 'first');
    const msgs02 = await db.getAccountMessages('02', 'first');

    console.log("Account 01 'first' messages:", msgs01);
    console.log("Account 02 'first' messages:", msgs02);
}

check().catch(console.error);
