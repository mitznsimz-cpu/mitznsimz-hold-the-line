# Hold the Line — Roadmap

*A snapshot of the living roadmap, taken at v1.7.8 when the game moved to GitHub for beta testing. The progress log at the end lists every release.*

2026-11-08 · Pete

Hold the Line grows from a working lane-defence baseline into a full tavern-defence game, with Mitz & Simz's tavern, the Cat & Mouse, as both the place you defend and the home you come back to. It gets there in seven phases, engine first, each shipped and tested before the next starts.

## Where we are

Version 1.7.8 is live, and all seven phases are done. It is packaged for its own GitHub repo, mitznsimz-hold-the-line, with its tests, ready for beta testing on GitHub Pages. The house plan opens once the Red Wyrm's Lair is won, and all six parts of the house are in: the kitchens, the brewhouse, the stables, the beer garden, the well and ice house, and the attic and roof, eighteen battles. Every hero earns a place: Simz plays any party properly, and his suggestions follow each battle's monsters. The cellar holds 18 battles: the Delve's monsters, L-, T- and U-shaped cellars, a crowded warren where small monsters pile up, and a belt of things to throw. The back room holds Endless, the Daily Challenge, the Boss Rush, five puzzles and Reverse. The minis pose as they fight, and every hero can stand as his figure or hers. Still open: Phase 4's frame rate needs a check on a real phone, and the cellar editor and a shared leaderboard are parked for later.

- **Battles:** 36 themed battles of 5 waves each on 25 floors: 18 in the cellar, from the open floor and a pillared cellar to a flooded crypt, a bridge over a chasm and L-, T- and U-shaped cellars, and 18 in the house, in the kitchens, the brewhouse, the stables, the beer garden, the well and ice house, and the attic and roof.
- **Heroes:** 13, each levelling to 3 and choosing one of two paths there, plus three allies (the hound, risen skeletons and the Tinker's ballista) and four cheap defenders that are always to hand. You take 6 heroes into each battle.
- **Monsters:** 66: the full Dungeon Delve bestiary, the orc and ogre, eleven that each break a rule the heroes rely on, and the house's own bosses, using behaviours such as ranged attacks, flying leaps, regeneration, splitting, summoning, swallowing and petrifying.
- **Art:** 94 unpainted minis drawn in code, in the shared minis library 2.5, with 133 fighting poses. Every Hold the Line unit is among them, and each figure is tagged with what it is made of.
- **Testing:** 233 game tests, which cover replays of the v1.0, v1.1 and v1.2 battles against frozen copies of their rules, every hero, path, defender and monster rule, a draw of every effect, the campaign's rules and save, items and the cats' powers, and Simz winning each battle in campaign order with only the heroes it has by then. Every mode is tested too: the Daily Challenge plays identically in two separate copies of the game, and every puzzle is solved by its own solution. There are also 19 mini tests, Simz as the balance tool on all four difficulties and on 60 Daily Challenges, and stall hunts across 2,800 games.

## The plan at a glance

*Diagram: roadmap · 7 phases, 6 gates (see the live roadmap doc).*

Each phase ships only after the same gate, and Phase 4 is the one that can move earlier without breaking anything.

## How we work

Every phase ships as a numbered version (Phase 1 is v1.1, Phase 5 is v1.5) to the same game link, and only after it passes the gate.

1. **Rules first.** New behaviour goes into the simulation with its tests before anything is drawn.
2. **Then the view.** Animation and interface follow the events the rules emit; the rules never touch the page.
3. **Then the gate.** A slice ships only when:
  - every game and mini test passes;
  - the balance report holds: Simz wins at least 80% of games in every battle on Medium, and a slow builder wins no more than 90%;
  - the stall hunt finds no endless games across 1,200 runs;
  - a phone and a desktop playthrough show no console errors or layout breaks.
4. **Then the log.** Each release gets a line in the progress log below and its tasks ticked here.

Files stay where they are, except the game itself: from v1.2 it is a page with its rules engine, a content pack and the shared minis file beside it, so sound, maps and new packs have room to grow. The test harness, the minis tools and the minis gallery stay as they are.

## Phase 1 — Engine (v1.1)

The battle mat becomes a level: any size and shape, with obstacles, terrain and several doors, on rules that every later phase reuses.

- [x] **Maps on an (x, y) grid.** A map sets its width, height, usable squares, obstacles, terrain, doors and the tavern edge. A row is still a lane, so Rangers and Fighters keep their rules.
- [x] **Monster paths.** A path map leads monsters from each door to the tavern, stepping round obstacles and changing rows at forks and bridges.
- [x] **Terrain with D&D rules:**
  - rubble and pillars block both sides and stop arrows;
  - difficult terrain halves monster speed;
  - high ground gives a hero +2 to hit;
  - holy ground deals 2 radiant damage a turn to undead;
  - pits stop walkers but not flyers.
- [x] **One effects system.** Timed statuses (paralysed, slowed, poisoned), and monster abilities as hooks that run in a fixed order (start of turn, before acting, on a hit, on a wound, when hurt), so a new effect is one new entry.
- [x] **Recall a hero** for half its cost back.
- [x] **Wave preview** between waves: who is coming next, which doors are open, and the way they will walk.
- [x] **Credits screen** with the 5e SRD attribution line.
- [x] **Three new maps** that prove the engine: pillars in a cellar, a crypt with two doors and flooded difficult ground, and lanes that merge onto a bridge over a pit.

**Done when** the six v1 battles replay identically from the same seeds, and the three new maps pass the gate.

## Phase 2 — Upgrades (v1.2)

Heroes level up where they stand, and at level 3 each takes one of two paths: the free 5e rules' own subclass, or an original Mitz & Simz one.

- [x] **Levels 1 to 3** bought with gold: tap a hero, pick from a chooser, see the stats change.
- [x] **Two paths per hero at level 3** (table below), each with one signature rule.
- [x] **Recall refunds** half of everything spent on that hero, upgrades included.
- [x] **Loadout picker:** choose 6 heroes before each battle, with suggestions based on its monsters.
- [x] **The ****Cat & Mouse****:** the start screen becomes the tavern. Mitz & Simz run the bar, battles are pinned to the notice board, and you pick your party from the regulars in the common room, with the cats' suggestions.
- [x] **Difficulty:** Easy, Medium, Hard and Deadly, using 5e's own encounter words.
- [x] **Simz learns** to upgrade, choose paths and pick a loadout, so balance testing keeps working.

| Hero | Free 5e rules path | Original path |
|---|---|---|
| Bard | Lore: Cutting Words, −2 to a nearby monster's attacks | Coinsinger: earns half as much gold again |
| Fighter | Champion: crits on 19 and 20 | Shieldwarden: shoves monsters back a square |
| Ranger | Hunter: Volley hits the target and the monster behind it | Houndmaster: a hound companion holds a square |
| Wizard | Evoker: a Fireball every second turn | Graveseer: monsters slain nearby rise as your skeletons for the wave |
| Cleric | Life: heals two heroes a turn | Dawnkeeper: Sacred Flame hits a 3 × 3 square and makes undead flee |
| Rogue | Thief: every hit pockets 2 gold | Cutthroat: the first hit on each monster is a critical |
| Barbarian | Berserker: rages twice before it is spent | Stonehide: survives its charge and stays as a blocker |

**Done when** each path has a test of its signature rule and every difficulty passes the balance gate.

## Phase 3 — Roster (v1.3)

The roster fills the missing roles (crowd control, traps, buffs and summons), and every new monster breaks a rule the heroes rely on.

- [x] **Six heroes:**
  - Paladin: an aura that shields neighbours, plus smite;
  - Druid: Entangle slows a 3 × 3 square, and Wild Shape becomes a blocking bear;
  - Monk: Stunning Strike, and catches arrows;
  - Warlock: Eldritch Blast knocks monsters back a square;
  - Sorcerer: lightning that jumps between lanes;
  - Tinker (original): builds a ballista and traps on empty squares.
- [x] **Four cheap defenders:** barricade, caltrops, oil flask (burns once), holy water font.
- [x] **Eleven monsters, each with a new rule:**
  - ankheg: burrows under the first hero;
  - hobgoblin shield wall: ranged attacks at monsters behind it have disadvantage;
  - imp: invisible unless near light;
  - wolf rider: becomes two units when unhorsed;
  - troll: regeneration stops for a turn after fire;
  - gelatinous cube: swallows a hero and carries it;
  - rust monster: strips a Fighter's armour;
  - medusa: turns a hero to stone, leaving an obstacle;
  - vampire: turns a hero against you for two turns;
  - necromancer: raises fallen monsters;
  - young red dragon (boss): flies, and its breath sweeps a whole lane.
- [x] **Two new battles** built around them.
- [x] **2****2**** new minis****,** drawn once in the shared library for both games: 6 heroes, 4 defenders, 11 monsters and the Tinker's ballista.

**Done when** every new unit has a mini, a description and a rule test, Simz uses every new hero somewhere, and the gate holds.

## Phase 4 — Juice (v1.4)

The minis feel heavier and the table feels real: every blow lands, every die tumbles, and the cats tidy up.

- [x] **Hit-stop:** attacker and target freeze for about a tenth of a second on big hits and crits.
- [x] **Wind-up and recoil:** a lean back before each swing, and a recoil that scales with damage.
- [x] **Tumbling d20** across the mat for crits and boss moments.
- [x] **Material effects** from one tag per mini: sparks off armour on a glancing blow, bone chips, stone dust, ooze splats, embers.
- [x] **Deaths with character:** falling away from the blow, constructs crumbling, spirits drifting up, and a cat paw (Mitz's or Simz's, taking turns) swatting fallen minis off the table.
- [x] **Torchlight** casts moving shadows, and flickers on dark maps.
- [x] **Sound** made in the browser: dice clatter, a clack on placement, sword clangs, spell whooshes, with a mute toggle.
- [x] **Extra poses** for headline heroes and bosses only. Shipped in v1.6.4 on minis 2.4.0: every mini leans back when hurt, and the heroes and bosses strike, cast, guard or breathe (103 poses on 80 figures).
- [x] **Reduced motion** setting respected by every effect.

**Done when** 40 units on the mat hold 60 frames a second on a throttled phone profile, and every effect can be switched off.

Status: every effect switches off in Settings. With 40 units on the mat at 4× CPU slowdown, the game's own code takes about 1 ms a frame against a 16.7 ms budget. The test machine draws in software, where v1.3.3 also manages only about 16 frames a second, so the frame rate itself needs a check on a real phone.

## Phase 5 — Campaign and modes (v1.5)

The Cat & Mouse becomes the hub between battles, like the town in Dungeon Delve, and new modes give players reasons to come back.

- [x] **The tavern grows:** rooms open as you win. The cellar map holds the battles, unlocked in order with 1 to 3 stars for lives kept. The armoury holds magic items, the trophy wall holds the bestiary, and the cats' corner holds their powers. Gold from battles repairs and extends the tavern.
- [x] **Tavern upgrades** bought with what you win, each one felt in battle: a stouter door (an extra life), a deeper till (more gold to start), a kitchen (short rests heal more), a training room (heroes join at level 2), and better ones as the Cat & Mouse grows.
- [x] **Goals to chase:** trophies for the trophy wall, won for feats such as a battle with no lives lost, every battle on Deadly, or one Barbarian charge that drops three monsters. Each comes with a small reward for the tavern.
- [x] **Unlocks and items:** heroes join along the way, and magic items won between battles are equipped by hero type (a +1 longsword for every Fighter, say).
- [x] **The cats' powers** on cooldowns: Mitz's Pounce stuns a 3 × 3 square for a round, Simz's Swat knocks a non-boss mini off the table. Who gets the bigger power alternates each battle.
- [x] **Modes:**
  - Endless: waves keep coming and scale, for a high score;
  - Daily Challenge: the same seed for everyone that day;
  - Boss Rush;
  - Puzzle battles with a fixed set of heroes;
  - Reverse: you send the monsters.
- [x] **Bestiary and hero book** in game, filling in as you meet things.
- [x] **Progress saved** in the browser.

**Done when** a new player can go from the campaign map through every battle, progress survives a reload, and the daily seed gives identical waves on two machines.

## Phase 6 — Deeper cellars (v1.6)

Dungeon Delve's new monsters come to the mat, the cellar takes new shapes, and crowds pile up for the things you throw at them.

- [x] **The Delve's bestiary:** its new monsters fight in Hold the Line, with free 5e rules stats where they exist, and each breaks a rule the heroes rely on (a mimic passing as a treasure chest, say). The minis are already shared.
- [x] **New battles** built around them, such as a drowned cistern for crabs, frogs and the drowned, and a tomb for mummies.
- [x] **L- and T-shaped maps.** The engine already finds the way on them; in a first test Simz won every L battle and most T ones.
- [x] **Shooting in any straight line**, and a Simz who defends the route rather than the rows, then **U-shaped maps**. Today shooters only fire along their row, so in a U nothing can shoot down a column, and Simz won none of 40 test battles.
- [x] **Pile-ups:** tiny and small monsters squeeze up to three to a square, as swarms do in 5e, in new battles only. The old battles keep one to a square, so their replays still hold.
- [x] **A belt of throwables** from the free 5e rules: holy water, alchemist's fire, acid, a net and ball bearings. Bought with the takings, thrown onto a square, and hitting everything piled there.
- [x] **Simz learns all of it**, so balance testing keeps working.

**Done when** every new monster has a mini, a rule and a test, Simz passes the gate on every new map including a U, and the old battles still replay exactly.

## Phase 7 — The rest of the house (v1.7)

Once the Red Wyrm's Lair falls, the monsters try the other ways in. A second campaign runs through the rest of the Cat & Mouse. Each part of the house has its own floor shapes and its own hazard, so no two battles play alike.

- [x] **Loose ends first (v1.6.5):** a female version of every hero who lacks one, each with its poses, and strike, cast and guard poses for the ranger, paladin and tinker. They go to the Delve as minis 2.5.0, and every hero gets a him-or-her choice in the tavern.
- [ ] **The house plan:** a second map in the hub that opens when the Lair is won and runs alongside the deeper cellars. Six parts of the house, three battles each, the last on the roof: 18 battles.
- [ ] **New floor shapes**, on floors that can be bigger than 5 by 10: a switchback where monsters snake through three corridors and the bends are where the hits land; a ring with two ways round; a funnel where two doors feed one throat; a wide yard; a long, narrow gallery.
- [ ] **Monsters that read the room:** on a ring, each monster takes whichever way round you have left weakest, so walling off one side doesn't work.
- [x] **Hatches** that burst open partway through a battle. A hero standing on one is knocked aside, and the wave preview warns a round before.
- [ ] **One set piece per part of the house:**
  - Kitchens: hatches, and ovens that flare every few rounds and burn whoever stands in front of them.
  - Brewhouse: barrels that roll down the chutes and bowl over anything in the way, heroes included.
  - Stables and yard: the ring round the hay barn, and the yard gate, which you can drop once a battle to shut one way round for a few rounds.
  - Beer garden (every good pub has one): a hedge maze where the monsters take the least-guarded way at every turn, a pond for the swimmers, and something that bursts up through the lawn.
  - Well and ice house: ice that walkers slide across, and the well's cold water.
  - Attic and roof: rafters, skylights that flyers drop through, and a boss on the roof.
- [ ] **A boss at the end of each part**, from the bestiary and the Delve's terrain monsters. Any new figure goes through the shared file.
- [ ] **Simz learns all of it**, so balance testing keeps working. The Daily Challenge and Endless can land on the new floors.
- [ ] **Trophies for the house**, such as clearing it, bowling over a pile of monsters with one barrel, and holding a ring with nothing getting through.

**Done when** every new floor and hazard has a rule and a test, Simz passes the gate on every new battle at every difficulty, the stall hunts are clean, and the old battles still replay exactly.

**Releases:** v1.7.0 the kitchens and the house plan; v1.7.1 the brewhouse; v1.7.2 the stables and yard; v1.7.3 the beer garden; v1.7.4 a pass so that every hero earns a place; v1.7.5 the well and ice house; v1.7.6 the attic and roof, closing the phase.

## Guardrails

Four rules hold across every phase. The cats' fur is settled: Mitz and Simz are both black cats.

- **Licensing (not legal advice):** monsters, spells and the one subclass per hero come from the free 5e rules (SRD, CC-BY 4.0), credited on the credits screen. Everything else gets an original name. "D&D" stays out of the title, and Wizards-only creatures stay out (beholder, mind flayer, displacer beast).
- **Brand:** red and gold, unpainted grey minis, and Mitz and Simz always take turns, in lines, powers and paws.
- **Determinism:** every rule-affecting roll goes through the seeded dice; randomness in effects stays in the view. That keeps replays, the daily seed and the tests honest.
- **Performance:** 60 frames a second with 40 units on a mid-range phone; minis drawn once and reused.

**Settled**** questions**

- Sound: made in the browser only, with no recorded clips.
- Hosting: the artifact while it was built; from v1.7.8, its own GitHub repo (mitznsimz-hold-the-line) on GitHub Pages, for beta testing.
- Shop links: none in the game. The credits page points to mitznsimz.co.uk.

**Later**

- A cellar editor: draw a floor and its waves, and share it as a code.
- A shared leaderboard for the Daily Challenge. There are two routes. One is the game artifact's own database, for signed-in claude.ai players it is shared with, with no server to run. The other, once the game is public, is a small server (a Cloudflare Worker) that replays each submitted run through the same rules before recording the score, so nobody needs to log in.

## Progress log

Newest first; one line per release.

| Date | Release | What shipped |
|---|---|---|
| 2026-11-09 | GitHub | Ready for beta testing. The Credits screen now shows the version (1.7.8), so testers can say which one they were playing. The game is packaged for its own GitHub repo, mitznsimz-hold-the-line, laid out like the Delve's: the game at the top level for GitHub Pages, the tests in tests/ with a gate script (run_gate.sh, and --full for the balance report and a 1,440-game stall hunt), this roadmap as docs/ROADMAP.md, issue templates for bugs and balance notes, MIT for the code, and the Mitz & Simz characters and figures kept as MitzNSimz's own. The full gate passes run from inside the repo, and the game loads cleanly from a sub-folder address on desktop and phone |
| 2026-11-09 | v1.7.8 | One swipe for the lot. The fallen now lie where they dropped until three are down on one side of the table, or the oldest has lain five seconds; then one cat sweeps everything on that side off in a single swipe, and swipes come at least two seconds apart. A Fireball's worth of goblins goes in one swipe, and in a busy fight there are about 40% fewer paws (29 for 49 deaths, against one each before). If paws are switched off, the fallen fade as before. The collar tags now sit just inside the table's edge, so the hero tray can't hide them. Checked on desktop and phone |
| 2026-11-09 | v1.7.7 | The cats' collars. Mitz and Simz are both black, so whenever a paw reaches in from the table's edge (top or bottom, or left or right on a phone, whichever is nearer), that cat's collar tag swings at the edge where it comes in: Mitz red with a gold M, Simz gold with a red S. Pounce always shows Mitz and Swat always shows Simz; the paws that clear the fallen still take turns. The Pounce and Swat buttons carry the same colours. Checked on desktop and phone |
| 2026-11-09 | v1.7.6 | The attic and roof, the last part of the house, which closes Phase 7. Skylights: like the trapdoors, floor you can stand on until something breaks in through one from the roof; after that, daylight falls on it and the squares round it, and anything undead there burns (2d6 a turn) and can't heal. Rafters: beams a hero can stand on for +2 to hit. Three battles: The Long Gallery (a long, narrow attic three rows wide, with shield walls along the floor and stone things through the roof), The Rafters (beams and chimney stacks) and The Attic, home of the house's last boss: the Lodger in the Attic, an old vampire who heals 20 a turn unless radiant fire or daylight sears him. A new trophy for the house, Cellar to rafters, for winning every battle in it, and a new last line when it falls quiet. Simz has his own plan for the rafters. Gate (233 game and 19 minis tests) and stall hunts over 450 games all clean |
| 2026-11-09 | v1.7.5 | The well and ice house, the fifth part of the house. Two new things on the floor. Ice: walkers slide across it twice as fast, and nobody can stand on it, so you fight from the floor beside it. The well: a way in out in the middle of the floor. Three battles: The Well Yard (the well in the middle of a cellar-sized yard, with frogs, crabs and the drowned climbing out), The Ice House (three ice runs, and the floor between them to fight from) and The Well (a boss). The boss, the Thing in the Well, reaches two squares with cold tentacles, swims, and heals 20 a turn while it stands in water or the well, so the trick is to catch it on dry floor. A new trophy, High and dry, for beating it out of the water. Easier first waves on Deadly where they were too hard: The Drowned Cistern (and Simz now walls its side doors first), The Rat Runs and The Scullery; Simz's suggestions now count flyers by number, so The Hedge Maze gets its Ranger back. The Barrow and The Long Drop are from v1.0 and must replay exactly, so their waves stay as they are. Fixed: a molehill or trapdoor that couldn't throw its hero clear could hold up a monster for ever; it now comes up on the nearest free square. Gate (228 game and 19 minis tests) and stall hunts over 450 games all clean |
| 2026-11-09 | v1.7.4 | A pass so that every hero earns a place. Simz now shares each job round the party: every hero who can hold a row, shoot or cast takes turns at those squares, so a second shooter or wall no longer sits idle. With no Fighter in the party, barricades hold the line; that alone took Fighter-less parties from about 40% to 85–96% on Hard. His suggested party now follows each battle's monsters: always a Bard, then the wall, shooter and caster that suit them best (a Paladin and a Cleric against undead, a Monk against rust monsters, a Tinker against burrowers), then two from jobs the party doesn't have yet. Every hero is suggested somewhere. Tests found no hero too weak to use: with a Bard, six very different parties win 85–98% on Hard. The Bard is essential, though. No party wins without one, even on Easy, so the Who needs a song trophy is now One-man band, for winning with just one Bard, and the party screen warns before a party goes down without one. In Reverse, Simz keeps the tavern with his standard six. Gate (221 game and 19 minis tests, including a new varied-party check) and stall hunts over 1,500 games all clean |
| 2026-11-09 | v1.7.3 | The beer garden, the fourth part of the house. Three battles: The Beer Garden (molehills in the lawn: you can stand on one until something comes up through it), The Fish Pond (frogs, crabs and the drowned swim straight across, and everything else goes round by the weaker side) and The Hedge Maze (rows of box hedge, three gaps that each split two ways, bats straight over the top, and a boss). Box hedges are new terrain: walkers go round, flyers go over, nobody stands in one, and everyone can see across. The boss, the Thing Under the Lawn, is a huge ankheg. Badly hurt, it dives, and two rounds later comes up through a molehill nearer the tavern, as hurt as it went down. It does this twice. A new trophy, Mown down, for beating it before it can dive. Fixed: the Strike! trophy could never be won, because the battle never passed the feat on. A new test now checks that every feat a trophy asks for gets through. Simz has his own plans for the lawn and the maze. Gate (217 game and 19 minis tests), stall hunts over 450 games, and playthroughs on desktop and phone all clean |
| 2026-11-08 | v1.7.2 | The stables, the third part of the house. Two new rules. On a ring, a monster that reaches a fork takes whichever way round the heroes cover least, and changes its mind when they move. And the yard gate: drop it once a battle (the Gate button, or G) and the top way round is shut for four rounds. Three battles: The Stable Yard (wide open, four doors, everything fast), The Hay Barn (the ring, with doors in the middle) and The Stables (the ring with the yard gate, and the Pack Leader, the biggest wolf with the biggest rider on it, as its boss). The route lines now show both ways round a ring, and where the gate sends everything while it is down. Simz drops the gate when three or more monsters are about to go through it, and has his own plan for the yard, with shooters on the rows the doors open onto. A new trophy, Both ways covered, for winning a battle round the hay barn without losing a life. Gate (210 game and 19 minis tests), stall hunts over 450 games, and playthroughs on desktop and phone all clean |
| 2026-11-08 | v1.7.1 | The brewhouse, the second part of the house. Barrel chutes: every few rounds a barrel shudders at the head of a chute, then rolls the row to the tavern, bowling over heroes and monsters alike (a Dex save jumps clear) until something big, or a barricade, stops it. Three battles: The Racks (a switchback through three runs, with a third door straight onto the last run and small monsters three to a door), The Vat Room (five runs past the vats) and The Brewhouse (four chutes, a safe middle row, and the Ferment, a gelatinous cube grown huge on the mash, as its boss). Simz meets barrels with a barricade near the tavern end of each chute. A new trophy, Strike!, for bowling over three monsters with one barrel. The stand-off rule now covers the house too. Gate (204 game and 19 minis tests), stall hunts over 450 games, and playthroughs on desktop and phone all clean |
| 2026-11-08 | v1.7.0 | The kitchens, the first part of the house. A new room in the hub, the house plan, opens once the Red Wyrm's Lair is won and lists the house's battles by part, each opening when the one before it is won. Three battles: The Larder (two trapdoors in the floor), The Scullery (two arms feeding one throat lined with ovens, where small monsters pile up three to a square) and The Great Kitchen (ovens on both walls, two hatches, and the Larder Ogre as its boss, standing on the ogre figure). Trapdoors are floor until their first monster comes up: they rattle the round before, and a hero standing on one is thrown aside and loses a turn. Ovens glow, then flare every four rounds, burning anything in front of them (a Dex save halves it; fire-proof things shrug). Floors can now be bigger than 5 by 10. Simz keeps off trapdoors and hot squares, his plan spreads across seven rows, and the scullery has its own plan. The cellar trophies still count only the cellar, Reverse stays in the cellar, and Daily and Endless can land on the new floors. Gate (199 game and 19 minis tests), a stall hunt over 360 games, and playthroughs on desktop and phone all clean |
| 2026-11-08 | v1.6.5 | Loose ends. Hold the Line drew a female version of the eleven heroes who lacked one, each with her poses, and the last hero poses (the ranger draws her bow, the paladin thrusts and guards, the tinker aims and builds). The Delve merged them as minis 2.5.0, and Hold the Line runs on it unchanged. In the common room each regular has a Him or Her button, and the tavern remembers the choice; only the figure changes, never the rules. The ranger, sculpted facing left, is turned round on the board to face the monsters. The credits page points to mitznsimz.co.uk, with no shop links in play. Settled: sound stays browser-made, the game stays an artifact for now, and the cellar editor and a Daily leaderboard wait for later. Gate (191 game and 19 minis tests) and playthroughs clean on desktop and phone |
| 2026-11-08 | v1.6.4 | Poses in play, on minis 2.4.0 from the Delve. A mini takes its stance while it acts (a lunge, a spell, a raised shield, the red dragon's breath) and leans back when it is hit or falls. Poses are mirrored so a mini always faces whoever it is fighting: a monster's axe swings at the heroes, not away from them. A new Poses setting turns them off. Posed sprites get a small margin so the goblin chief's lunge isn't clipped. Every figure is still drawn from the shared library; no renders. The minis file grows from 335 KB to 577 KB with the pose data. Gate (190 game and 18 minis tests) and playthroughs clean on desktop and phone |
| 2026-11-08 | v1.6.3 | Phase 6 complete. Pile-ups: in a crowded battle the small monsters (rats, kobolds, goblins, bats, grubs, imps and wisps) squeeze up to three to a square, and are drawn spread out so all three show. The Rat Runs is the first crowded battle, making 18. The belt is sold in the armoury from the takings: holy water (2d6 radiant to undead and fiends), alchemist's fire (1d4 fire a turn for 3 rounds), acid (2d6), a net (holds anything under 60 hit points for 2 rounds) and ball bearings (DC 10 Dex or lose a turn, for 3 rounds). Each is thrown onto one square, one throw a round, and hits everything piled there. Simz throws at the piles in Auto. The belt stays behind on Deadly and in the fixed battles. Gate, stall hunts and playthroughs clean |
| 2026-11-08 | v1.6.2 | Where the way turns, shooters also see up and down their column. Simz fits the build to a bent cellar and guards the route: any monster near the tavern that nothing can reach gets a shooter with a clear line to it. A U-shaped map, the Horseshoe, has corridors two squares wide, so there is room beside the way. The Kennels runs on it with hounds, wolves, beetles, spiders, bears and an ogre, making 17 battles. Simz wins all 30 test games on the Kennels, where on the first, one-square-wide U he won none of 40. The old floors keep their rules. Gate, stall hunts and playthroughs clean |
| 2026-11-08 | v1.6.1 | Two new shapes of cellar: an L (the Back Stores, with orcs, wolf riders, hobgoblins and ogres) and a T (the Old Crossing, with undead from above and below and invisible imps), making 16 battles. Where the way turns, Fighters and other blades reach up and down as well as along their row. A stand-off ends with the nearest monster walking in, as in the modes. The old floors keep their rules, so their replays still hold. Gate, stall hunts and playthroughs clean |
| 2026-11-08 | v1.6.0 | Phase 6 begins with the Delve's bestiary, on its minis 2.3.0 figures, each breaking a rule the heroes rely on. The giant crab's shell halves arrows, and it wades straight through water. The giant frog's tongue reaches the hero behind the first. The drowned get back up once, unless the blow was holy or a critical. Animated armour takes 2 less from every weapon hit. The mimic turns up as a treasure chest mid-mat and wakes when a hero comes close, and its hits stick. A mummy's touch stops healing for 3 rounds, and fire does it double. A salamander burns whoever hits it up close, and fire does nothing to it. Three new battles: the Drowned Cistern, the Sealed Tomb and the Old Forge (14 in all). The poses for minis 2.4.0 were handed to the Delve (27 on 12 figures). Gate, stall hunts and playthroughs clean |
| 2026-11-08 | v1.5.3 | Phase 5 complete. Reverse joins the back room: for any battle you have won, you send its monsters up the steps from a purse that fills each round (40 rounds), and Simz keeps the tavern. Pick a monster, then tap a door or any square in its row. The boss can be sent once. In testing, a steady trickle of the cheapest monster took 2 of 11 taverns and a crowd at the weakest door took 8. Two new trophies make 27. Gate, stall hunts and playthroughs clean |
| 2026-11-08 | v1.5.2 | The back room opens after three wins. Endless sends waves that keep getting worse, with a boss every fifth wave, for a best score. The Daily Challenge gives everyone the same battle, party and dice each day (by UTC date) and scores it. The Boss Rush sends every boss in order, each with its own escort. Five puzzles each give a few free heroes, no gold and one life, and each is proven winnable by a test. All are made from seeded ids, so the same id plays the same everywhere. In the modes, a wave that stalls long after its last arrival ends with the nearest monster walking in; campaign battles keep their old rules. Deadly now leaves the tavern's upgrades and items behind, and only the cats come along. Four new Deadly trophies and five for the modes make 25. Gate, stall hunts and playthroughs clean |
| 2026-11-08 | v1.5.1 | The armoury holds 13 magic items. Eleven come up from battles the first time each is won, and two are trophy rewards. An item is given to one kind of hero, and every hero of that kind carries it into battle. The cats' corner opens, and the cats' powers work in battle: Mitz's Pounce stuns every monster in a 3 × 3 square for a round, and Simz's Swat knocks any monster but a boss off the table. The keys are Q and W. The cat on watch alternates each battle and gets their power twice as often. Materials now come from the shared minis library 2.3.0. Gate, stall hunt and playthroughs clean |
| 2026-11-08 | v1.5.0 | Phase 5 begins: the Cat & Mouse is the hub, with rooms that open as you win. The cellar map opens the battles in order, with 1 to 3 stars for lives kept. Wins pay takings for a stouter door, a deeper till, the kitchen and the training room. 16 trophies with rewards; the trophy wall holds every monster met and the hero book. Five regulars to start, the rest joining along the way. Progress is saved in the browser, and old wins carry over |
| 2026-11-08 | v1.4 | Phase 4, Juice: hit-stop on crits and heavy blows; a wind-up before every swing and knock-back scaled by damage; a d20 that tumbles across the mat on crits and boss kills; sparks, bone chips, dust, splats and embers by material; constructs crumble, spirits drift, oozes melt, and Mitz and Simz take turns swatting fallen monsters off the table; torches with moving shadows and six dark battles; browser-made sound with M to mute; a Settings panel where every effect switches off, Reduced motion included. Shared modules: motion 1.1.0 and sound 1.0.0. Gate, stall hunt and playthroughs clean; poses wait on minis 2.2 |
| 2026-11-08 | v1.3.3 | Phase 3 finished: the 22 new minis, drawn here and merged by the Delve into the shared library 2.1.0. No placeholders left; defenders and the ballista stand on the walnut base. Full gate, stall hunt and browser playthroughs clean |
| 2026-11-08 | v1.3.2 | Moved to the shared minis library 2.0.0 through Hold the Line's own adapter: 450 of 459 renders identical to before, the rest one pixel off. Fixed the shared motion module (1.0.1): a landing fireball no longer stops effects drawing. Games saved before traps existed now resume |
| 2026-11-08 | v1.3 | Phase 3 rules: Paladin, Druid, Monk, Warlock, Sorcerer and Tinker with two paths each; barricade, holy water font, caltrops and oil flask; eleven monsters, each breaking a rule; the Hobgoblin March and the Red Wyrm's Lair. Every new unit uses the placeholder mini until the shared minis v2.0 lands; Hold the Line's 50 figures handed to the Delve session in its format. Stall hunts clean after fixing a vampire stalemate |
| 2026-11-08 | v1.2 | Phase 2, Upgrades: levels 1 to 3 and 14 paths (7 from the SRD, 7 original) with a test each; hound and risen-skeleton allies; recall refunds half of everything spent; Easy, Medium, Hard and Deadly; the notice board and the common room, where you pick a party of 6 with the cats' suggestions; Simz levels up and picks paths and a party. The tavern is now the Cat & Mouse, and the game is split into a page, rules engine, content pack and the shared minis file. v1.0 and v1.1 battles replay identically on Medium; stall hunts clean |
| 2026-11-08 | v1.1 | Phase 1, Engine: maps with pillars, water, raised ledges, holy ground, chasms and side doors; three new battles (nine in all); recall for half cost; next-wave preview with routes on the mat; credits with the SRD attribution. All six v1.0 battles replay identically; stall hunt clean across 1,215 games |
| 2026-11-08 | Roadmap | This plan agreed; Phase 1 started |
| 2026-10-11 | v1.0 | Cleric, Rogue and Barbarian join; Wizards aim into the next lane; 1,200-game stall hunt clean |
| 2026-10-11 | v0.3 | Six themed battles bring all 42 monsters onto the mat, with 13 monster behaviours and Auto mode |
| 2026-10-11 | v0.2 | Minis split into a shared file for both games; full 40-monster bestiary drawn |
| 2026-10-11 | v0.1 | Feel test: one battle, four heroes, goblins, orcs and an ogre |

