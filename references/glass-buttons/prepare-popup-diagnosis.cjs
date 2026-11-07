// Recreate a throwaway copy; never imported by the planner or a build script.
const fs=require('node:fs'),path=require('node:path');
const landing=path.resolve(__dirname,'../../landing'),marker='<!-- Local diagnosis copy; do not deploy -->';
const source=fs.readFileSync(path.join(landing,'index.html'),'utf8'),needle='<script src="./planner-model.js">';
if(!source.includes(needle))throw Error('Planner entry changed; review diagnostic injection first.');
for(const name of ['popup-diagnosis.html','popup-diagnosis.js'])if(fs.existsSync(path.join(landing,name)))throw Error(`${name} already exists; inspect it before replacing.`);
fs.writeFileSync(path.join(landing,'popup-diagnosis.html'),source.replace('<!doctype html>','<!doctype html>\n'+marker).replace(needle,'<script src="./popup-diagnosis.js"></script>'+needle));
fs.copyFileSync(path.join(__dirname,'popup-diagnosis.js'),path.join(landing,'popup-diagnosis.js'));
console.log('Created local diagnosis-only pages. Remove them before any deployment.');
