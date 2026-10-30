// Run before every deploy: stamps a new version into version.json and tags every script/stylesheet with it,
// so browsers never mix a new page with cached old scripts (and the in-app update check can spot the change).
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const v = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
fs.writeFileSync(new URL('version.json', root), JSON.stringify({ v }) + '\n');
const mods = fs.readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js'));
const map = Object.fromEntries(mods.map((f) => [`./js/${f}`, `./js/${f}?v=${v}`]));
let h = fs.readFileSync(new URL('index.html', root), 'utf8');
const block = `<!--VER-START--><link rel="stylesheet" href="css/style.css?v=${v}">\n<script type="importmap">${JSON.stringify({ imports: map })}</script><!--VER-END-->`;
h = h.replace(/<!--VER-START-->[\s\S]*?<!--VER-END-->/, block).replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/, `<script type="module" src="js/main.js?v=${v}"></script>`);
fs.writeFileSync(new URL('index.html', root), h);
console.log('stamped version', v, `(${mods.length} modules)`);
