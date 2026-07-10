const fs = require('fs');
const file = 'C:/Users/ADMIN/.gemini/antigravity/scratch/clipper-tracker/public/app.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/matchupsList: \[\],?\s*/g, '');
content = content.replace(/state\.matchupsList = data\.matchupsList \|\| \[\];\s*/g, '');

content = content.replace(/\} else if \(key === 'matchups'\) \{\s*endpoint = '\/api\/db\/matchups';\s*bodyContent = state\.matchupsList;\s*/g, '}');

content = content.replace(/\/\/ Matchup Modal Control[\s\S]*?(?=\/\/ Sort filter event listener)/g, '');

content = content.replace(/\s*renderMatchups\(\);\s*/g, '\n    ');

content = content.replace(/function renderMatchups\(\) \{[\s\S]*?(?=window\.deleteMatchup)/g, '');
content = content.replace(/window\.deleteMatchup = function\(id\) \{[\s\S]*?(?=function populateMatchupDropdowns)/g, '');
content = content.replace(/function populateMatchupDropdowns\(\) \{[\s\S]*?(?=\/\/ --- CHART & DATA LOGIC ---)/g, '');

content = content.replace(/const demoMatchups = \[[\s\S]*?(?=const demoSchedules = \[)/g, '');
content = content.replace(/state\.matchupsList = demoMatchups;\s*/g, '');
content = content.replace(/await saveStateToServer\('matchups'\);\s*/g, '');
content = content.replace(/if \(targetTab === 'matchups'\) subtitle = "Side-by-side clip comparisons";\s*/g, '');

fs.writeFileSync(file, content);
console.log('Cleaned app.js');
