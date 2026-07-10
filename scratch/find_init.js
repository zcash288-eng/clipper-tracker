const fs = require('fs');
const code = fs.readFileSync('C:\\Users\\ADMIN\\.gemini\\antigravity\\scratch\\clipper-tracker\\public\\app.js', 'utf8');
const lines = code.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('localStorage') || line.includes('/api/db') || line.includes('fetchDb') || line.includes('loadState')) {
        console.log(`Line ${idx + 1}: ${line}`);
    }
});
