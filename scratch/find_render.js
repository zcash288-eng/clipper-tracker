const fs = require('fs');
const code = fs.readFileSync('C:\\Users\\ADMIN\\.gemini\antigravity\\scratch\\clipper-tracker\\public\\app.js', 'utf8');
const lines = code.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('function renderAll') || line.includes('renderAll(')) {
        console.log(`Line ${idx + 1}: ${line}`);
    }
});
