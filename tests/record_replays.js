// Records tests/replays.json from the rules as they are now. Run it only when a change to how battles play is meant,
// and say so in the release: the game tests compare every battle against this file.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..'), box = {}; vm.createContext(box);
for (const f of ['pack-core.js', 'sim.js', 'modes.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), box, { filename: f });
const kit = require('./replay_kit.js'), t0 = Date.now(), all = kit.recordAll(box.HTL);
const version = (fs.readFileSync(path.join(dir, 'view', 'core.js'), 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];
fs.writeFileSync(path.join(__dirname, 'replays.json'), JSON.stringify({ recorded: version, replays: all }, null, 1) + '\n');
console.log(Object.keys(all).length + ' replays recorded from v' + version + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
