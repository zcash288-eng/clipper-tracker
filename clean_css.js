const fs = require('fs');
const file = 'C:/Users/ADMIN/.gemini/antigravity/scratch/clipper-tracker/public/style.css';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/\/\* --- TAB: MATCHUPS \(SHORTS VS REELS\) --- \*\/[\s\S]*?(?=\/\* --- TAB: POST SCHEDULER & TASKS --- \*\/)/g, '');

fs.writeFileSync(file, content);
console.log('Cleaned style.css');
