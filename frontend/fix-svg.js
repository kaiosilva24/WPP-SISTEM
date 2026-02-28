const fs = require('fs');
const content = fs.readFileSync('src/assets/logo.svg', 'utf8');
const newContent = content.replace('<rect x="-81" width="972" fill="#fdfefd" y="-80.999999" height="971.999992" fill-opacity="1"/>', '');
fs.writeFileSync('src/assets/logo.svg', newContent, 'utf8');
console.log('Done!');
