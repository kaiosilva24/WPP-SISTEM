const proxyChain = require('proxy-chain');

async function test() {
    try {
        const url = await proxyChain.anonymizeProxy({ url: 'http://user:pass@127.0.0.1:8080', port: 9999 });
        console.log(url);
        await proxyChain.closeAnonymizedProxy(url, true);
    } catch (e) {
        console.error(e);
    }
}
test();
