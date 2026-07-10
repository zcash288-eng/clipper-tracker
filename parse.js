const fs = require('fs');
const text = fs.readFileSync('ext_debug.json', 'utf8');
const lines = text.split('\n');
const resStr = lines.find(l => l.includes('Result:'));
const data = JSON.parse(resStr.substring(resStr.indexOf('{')));
console.log("Keys:", Object.keys(data.data));
if (data.data.edge_felix_video_timeline) {
  console.log("Felix videos:", data.data.edge_felix_video_timeline.edges.length);
} else {
  console.log("No felix timeline");
}
if (data.data.edge_owner_to_timeline_media) {
  console.log("Timeline videos:", data.data.edge_owner_to_timeline_media.edges.length);
} else {
  console.log("No owner timeline");
}
