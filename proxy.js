const fs = require('fs');
const path = 'C:\\\\Users\\\\ADMIN\\\\.gemini\\\\antigravity\\\\scratch\\\\clipper-tracker\\\\public\\\\app.js';
let appCode = fs.readFileSync(path, 'utf8');

appCode = appCode.replace(/src=\"\$\{c\.avatar\}\"/g, 'src=\"${getSafeImageUrl(c.avatar)}\"');
appCode = appCode.replace(/src=\"\$\{c\.avatar \|\|/g, 'src=\"${getSafeImageUrl(c.avatar) ||');
appCode = appCode.replace(/imgSrc = channel\.avatar;/g, 'imgSrc = getSafeImageUrl(channel.avatar);');

fs.writeFileSync(path, appCode);
console.log('Successfully proxied all avatars!');
