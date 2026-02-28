const http = require('http');

const boundary = '----formbound' + Date.now();
const fileData = Buffer.from('fake jpg data for testing');

const parts = [
    '--' + boundary + '\r\n',
    'Content-Disposition: form-data; name="files"; filename="test.jpg"\r\n',
    'Content-Type: image/jpeg\r\n',
    '\r\n',
];
const body = Buffer.concat([
    Buffer.from(parts.join('')),
    fileData,
    Buffer.from('\r\n--' + boundary + '--\r\n')
]);

const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/accounts/media/upload/images',
    method: 'POST',
    headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
    }
}, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => console.log('STATUS:', res.statusCode, '\nBODY:', d));
});

req.on('error', e => console.log('ERR:', e.message));
req.write(body);
req.end();
