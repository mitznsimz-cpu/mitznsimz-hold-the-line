// Frozen copy of the v1.1 simulation, for replay tests. Do not edit.

/* Deterministic simulation. Plain data in, plain data out: no DOM, no clocks.
   The page and the Node harness both drive it through HTL.step(state, dt). */
var HTL = (function () {
  'use strict';
  const ROUND = 2.0;                         // real seconds per combat round
  const LIVES = 5, PREP_ROUNDS = 4, REST_ROUNDS = 4;

  /* Heroes. targeting: adjacent (front or back in its lane), lane (nearest monster ahead), lanes (the same, then the
     lanes either side), around (any of the
     eight squares round it), charge (rushes the first monster ahead, once). recharge: rounds before another can be placed. */
  const HEROES = {
    bard:      { name: 'Bard', role: 'Earns gold', cost: 50, hp: 12, ac: 13, init: 3,
                 income: { every: 3, gold: 20 },
                 info: 'Plays for coin: 20 gold every third turn. Keep Bards at the back.' },
    fighter:   { name: 'Fighter', role: 'Holds the line', cost: 50, hp: 30, ac: 18, init: 0, targeting: 'adjacent',
                 attack: { name: 'Longsword', bonus: 5, n: 1, d: 8, mod: 3, kind: 'melee', fx: 'slash' },
                 info: 'Heavy armour and a longsword. Blocks its lane and hits a monster next to it, in front or behind.' },
    ranger:    { name: 'Ranger', role: 'Shoots down the lane', cost: 100, hp: 14, ac: 14, init: 3, targeting: 'lane',
                 attack: { name: 'Longbow', bonus: 6, n: 1, d: 8, mod: 3, kind: 'ranged', fx: 'arrow' },
                 info: 'Shoots the nearest monster ahead in its lane, at any range.' },
    wizard:    { name: 'Wizard', role: 'Fireball every third turn', cost: 150, hp: 12, ac: 12, init: 2, targeting: 'lanes',
                 attack: { name: 'Fire Bolt', bonus: 5, n: 1, d: 10, mod: 0, kind: 'ranged', fx: 'bolt', magic: true },
                 spell: { name: 'Fireball', every: 3, n: 3, d: 6, dc: 13, radius: 1 },
                 info: 'Fire Bolt every turn and a Fireball every third turn, down its lane or the next lane over when its own is clear. Spells hit resistant monsters at full strength.' },
    cleric:    { name: 'Cleric', role: 'Heals heroes nearby', cost: 75, hp: 18, ac: 16, init: 1, targeting: 'lane',
                 heal: { n: 1, d: 8, mod: 3, reach: 2 },
                 attack: { name: 'Sacred Flame', bonus: 5, n: 1, d: 8, mod: 0, kind: 'ranged', fx: 'radiant', magic: true, holy: true },
                 info: 'Healing Word: heals the most hurt hero within two squares, and cures paralysis. With nobody to heal, calls down Sacred Flame, which burns undead twice as hard.' },
    rogue:     { name: 'Rogue', role: 'Stabs sideways too', cost: 75, hp: 18, ac: 15, init: 4, targeting: 'around',
                 attack: { name: 'Shortsword', bonus: 6, n: 1, d: 6, mod: 4, kind: 'melee', fx: 'slash' },
                 sneak: { n: 2, d: 6 },
                 info: 'Stabs a monster in any of the eight squares around it, including the lanes either side. Sneak Attack adds 2d6 when another hero is next to the target.' },
    barbarian: { name: 'Barbarian', role: 'One raging charge', cost: 100, recharge: 8, hp: 30, ac: 14, init: 2, targeting: 'charge',
                 attack: { name: 'Raging greataxe', bonus: 6, n: 2, d: 12, mod: 5, kind: 'melee', fx: 'smash', reckless: true },
                 info: 'Rages as soon as a monster is ahead in its lane: charges it, swings at everything around it with advantage, then is spent. The next Barbarian is ready 8 rounds later.' }
  };

  /* Monsters. A type name is also the name of its mini in MitzMinis.
     Attack: to-hit bonus, n d-sided dice + mod; kind melee or ranged; range in squares (default 1);
     extra: [n, d] more dice on a hit, such as poison.
     Traits: flying (leaps over the first hero in its way), multi (attacks a turn), regen (hit points a turn),
     resist (half damage from weapons; the Wizard's spells hit fully), drain (heals by half the damage it deals),
     paralyse (a hit can freeze a hero for a turn), split (divides in two when first badly hurt),
     summon { type, every, max }, mend { every, n, d } (heals a wounded monster nearby), boss,
     undead (the Cleric's Sacred Flame does double damage). */
  const A = (name, bonus, n, d, mod, o) => Object.assign({ name, bonus, n, d, mod, kind: 'melee', fx: 'slash', range: 1 }, o || {});
  const M = (name, level, hp, ac, init, dexSave, speed, bounty, attack, traits) =>
    ({ name, level, hp, ac, init, dexSave, speed, bounty, attack, traits: traits || {} });
  const BOW = range => ({ kind: 'ranged', fx: 'arrow', range });
  const HEX = (fx, range) => ({ kind: 'ranged', fx, range });
  const SMASH = { fx: 'smash' };
  const UNDEAD = { undead: true };

  // Headline monsters carry extra hit points so they last long enough to show what they do against a full board.
  const MONSTERS = {
    // the goblin warren
    direRat:       M('Dire Rat', 1, 5, 12, 2, 2, 1.25, 3, A('Bite', 4, 1, 4, 2)),
    kobold:        M('Kobold', 1, 5, 12, 2, 2, 1, 4, A('Rusty spear', 4, 1, 4, 2)),
    goblin:        M('Goblin', 1, 7, 15, 2, 2, 1, 5, A('Scimitar', 4, 1, 6, 2)),
    caveBat:       M('Cave Bat', 1, 8, 13, 3, 3, 1.5, 6, A('Wing', 4, 1, 4, 2), { flying: true }),
    goblinArcher:  M('Goblin Archer', 1, 7, 13, 2, 2, 1, 6, A('Short bow', 4, 1, 6, 2, BOW(4))),
    goblinShaman:  M('Goblin Shaman', 2, 10, 12, 2, 1, 0.75, 10, A('Hex', 4, 2, 4, 0, HEX('shadow', 3))),
    goblinChief:   M('Goblin Chief', 3, 80, 17, 1, 1, 0.75, 40, A('Iron axe', 5, 1, 8, 3), { multi: 2, boss: true }),
    // the deep caves
    deepLeech:     M('Deep Leech', 2, 8, 10, 1, 1, 0.75, 4, A('Latch', 4, 1, 4, 2), { drain: true }),
    warrenHound:   M('Warren Hound', 2, 16, 13, 3, 3, 1.5, 8, A('Savage bite', 5, 1, 8, 2)),
    caveSerpent:   M('Cave Serpent', 2, 18, 13, 2, 2, 0.75, 9, A('Bite', 5, 1, 6, 2, { extra: [1, 6] })),
    tombSpider:    M('Tomb Spider', 3, 26, 14, 3, 3, 1, 14, A('Venom fang', 5, 1, 8, 3, { extra: [1, 6] })),
    direWolf:      M('Dire Wolf', 3, 30, 14, 2, 2, 1.5, 15, A('Savage bite', 5, 2, 6, 3)),
    giantBeetle:   M('Carrion Beetle', 3, 30, 16, 0, 0, 0.75, 15, A('Mandibles', 4, 2, 4, 2), { resist: true }),
    caveBear:      M('Cave Bear', 4, 85, 13, 1, 0, 0.75, 35, A('Maul', 6, 2, 6, 4, SMASH), { multi: 2 }),
    // the old crypt
    rotGrub:       M('Rot Grub', 2, 6, 10, 0, 0, 0.5, 3, A('Burrow', 3, 1, 4, 0, { extra: [1, 4] })),
    skeleton:      M('Skeleton', 2, 13, 13, 2, 2, 0.75, 7, A('Rusted blade', 4, 1, 6, 2), UNDEAD),
    skelArcher:    M('Skeleton Archer', 2, 13, 13, 2, 2, 0.75, 8, A('Warped bow', 4, 1, 6, 2, BOW(4)), UNDEAD),
    ghoul:         M('Ghoul', 3, 22, 12, 2, 2, 1, 12, A('Raking claws', 4, 2, 4, 2), { paralyse: true, undead: true }),
    shadeWisp:     M('Shade Wisp', 3, 12, 14, 3, 3, 1, 10, A('Chill', 5, 1, 8, 2, HEX('shadow', 3)), UNDEAD),
    boneKnight:    M('Bone Knight', 4, 40, 17, 0, 0, 0.5, 25, A('Greatsword', 6, 2, 6, 3), { resist: true, undead: true }),
    cryptWarden:   M('Crypt Warden', 4, 45, 16, 0, 0, 0.5, 25, A('Halberd', 6, 1, 10, 3, { range: 2 }), UNDEAD),
    shade:         M('The Shade of Grelminar', 5, 160, 15, 2, 2, 0.4, 100, A('Withering touch', 6, 2, 8, 3, HEX('shadow', 3)),
                     { regen: 4, summon: { type: 'shadeWisp', every: 3, max: 4 }, boss: true, undead: true }),
    // the warband road
    brigand:       M('Brigand', 3, 16, 14, 2, 2, 1, 10, A('Shortsword', 4, 1, 6, 2)),
    brigandArcher: M('Brigand Archer', 3, 14, 13, 2, 2, 1, 10, A('Shortbow', 4, 1, 8, 2, BOW(4))),
    orcRaider:     M('Orc Raider', 2, 13, 13, 1, 1, 1, 8, A('Cleaver', 5, 1, 8, 3)),
    orc:           M('Orc', 2, 15, 13, 1, 1, 0.75, 10, A('Greataxe', 5, 1, 12, 3)),
    lizardfolk:    M('Lizardfolk', 3, 22, 15, 0, 0, 0.75, 12, A('Barbed spear', 4, 1, 8, 2, { range: 2 })),
    renegadeMage:  M('Renegade Mage', 4, 22, 12, 2, 2, 0.75, 20, A('Arc bolt', 6, 2, 6, 2, HEX('bolt', 4))),
    fallenPriest:  M('Fallen Priest', 4, 30, 14, 1, 0, 0.5, 20, A('Smite', 5, 1, 10, 2, HEX('shadow', 3)),
                     { mend: { every: 2, n: 2, d: 6 } }),
    ogre:          M('Ogre', 4, 85, 11, -1, -1, 0.5, 30, A('Greatclub', 6, 2, 8, 4, SMASH)),
    orcChampion:   M('Orc Champion', 4, 95, 16, 1, 1, 0.75, 40, A('Greataxe', 7, 1, 12, 4), { multi: 2 }),
    // the barrow
    wight:         M('Wight', 5, 45, 14, 1, 1, 0.75, 30, A('Withering touch', 6, 1, 10, 3), { drain: true, undead: true }),
    wraith:        M('Wraith', 6, 55, 13, 3, 3, 1, 40, A('Chill grasp', 6, 2, 8, 3), { flying: true, drain: true, resist: true, undead: true }),
    boneTitan:     M('Bone Titan', 7, 110, 15, -1, -1, 0.5, 55, A('Sweeping femur', 7, 3, 6, 4, SMASH), { resist: true, undead: true }),
    barrowLich:    M('Barrow Lich', 7, 200, 16, 2, 2, 0.4, 150, A('Deathbolt', 7, 3, 8, 0, HEX('shadow', 4)),
                     { regen: 4, summon: { type: 'skeleton', every: 3, max: 5 }, boss: true, undead: true }),
    // the deep halls
    emberWisp:     M('Ember Wisp', 3, 14, 14, 3, 3, 1, 12, A('Searing touch', 5, 1, 8, 2, HEX('bolt', 2)),
                     { summon: { type: 'emberWisp', every: 3, max: 1 } }),
    gloom:         M('Gloom', 4, 40, 8, -1, -1, 0.5, 20, A('Engulf', 5, 2, 6, 1), { split: true }),
    gargoyle:      M('Gargoyle', 5, 40, 15, 1, 2, 1, 30, A('Stone claws', 5, 2, 6, 2), { flying: true, resist: true }),
    ironSentinel:  M('Iron Sentinel', 4, 55, 17, 0, -1, 0.5, 35, A('Piston fist', 6, 2, 6, 3, SMASH), { resist: true, regen: 3 }),
    clayGolem:     M('Clay Golem', 6, 120, 14, -1, -1, 0.4, 60, A('Slam', 7, 2, 10, 4, SMASH), { resist: true }),
    deepHorror:    M('Deep Horror', 8, 150, 15, 1, 1, 0.5, 100, A('Grasping dark', 7, 3, 8, 4, HEX('shadow', 2)), { regen: 5, split: true }),
    stoneColossus: M('Stone Colossus', 8, 300, 17, -2, -2, 0.3, 200, A('Crushing fist', 8, 3, 10, 5, SMASH),
                     { multi: 2, resist: true, boss: true })
  };

  /* Battles. Spawn tokens: type:round, type:round*count for several at once through different doors,
     and @n on the end to send them through door n of the map (doors are numbered in reading order).
     Rounds count from the start of the wave. A wave's doors list limits which doors it uses; without one it uses them all.
     map: one of MAPS below; the cellar floor if left out. */
  const BATTLES = [
    { id: 'warren', name: 'The Goblin Warren', gold: 150, by: 'Simz',
      line: 'Something has been nicking the cheese. Something with a lot of cousins.',
      waves: [
        { name: 'Rats in the Cellar', by: 'Simz', line: 'Just rats. Big ones. Lots of them.',
          spawns: 'direRat:0*2 direRat:3 kobold:5 direRat:7*2 kobold:9 kobold:11' },
        { name: 'Kobold Tunnels', by: 'Mitz', line: 'Kobolds hit and run. In their own tunnels they mostly hit.',
          spawns: 'kobold:0*2 goblin:2 kobold:4 goblin:6 caveBat:8 kobold:9*2 goblin:11' },
        { name: 'Bats in the Rafters', by: 'Simz', line: 'Bats fly straight over your first hero. Keep a second line behind it.',
          spawns: 'caveBat:0 goblin:1 caveBat:3*2 goblinArcher:5 goblin:6 goblinArcher:8 caveBat:9*2 goblin:11' },
        { name: "The Shaman's Drums", by: 'Mitz', line: "Archers and shamans stand back and shoot. Rangers can reach them. Fighters can't.",
          spawns: 'goblin:0*2 goblinArcher:2 goblinShaman:4 goblin:5 kobold:6*2 goblinArcher:8 goblinShaman:10 caveBat:11*2 goblin:12*2' },
        { name: 'The Goblin Chief', by: 'Simz', line: 'The boss of the goblins. Two axe swings a turn and a very big shield.',
          spawns: 'goblin:0*2 goblinArcher:1 kobold:2*2 goblinShaman:4 goblin:5*2 goblinChief:7 goblinArcher:8*2 caveBat:9 goblin:10*2 direRat:12*3' }
      ] },
    { id: 'caves', name: 'The Deep Caves', gold: 200, by: 'Mitz',
      line: 'The cellar goes deeper than the landlord admits. Things live down there.',
      waves: [
        { name: 'Things in the Dark', by: 'Mitz', line: 'Leeches heal themselves on whatever they bite. Don’t let them feed.',
          spawns: 'direRat:0*2 deepLeech:3 direRat:5 caveBat:7 direRat:8*2 deepLeech:10*2 warrenHound:12' },
        { name: 'The Hunting Pack', by: 'Simz', line: 'Hounds can sprint two squares at a time. They arrive sooner than you think.',
          spawns: 'warrenHound:0 warrenHound:2*2 caveSerpent:4 direRat:5*2 warrenHound:7 caveSerpent:9 warrenHound:10*2' },
        { name: 'Webs', by: 'Mitz', line: 'Spiders and serpents. The poison makes every bite hurt more than it looks.',
          spawns: 'tombSpider:0 caveSerpent:2 tombSpider:4 deepLeech:5*3 tombSpider:7 caveBat:8*2 caveSerpent:10 tombSpider:12' },
        { name: 'Wolves and Beetles', by: 'Simz', line: 'Beetle shells shrug off swords and arrows. Fire Bolts go straight through.',
          spawns: 'direWolf:0 giantBeetle:2 warrenHound:3*2 direWolf:5 giantBeetle:7 tombSpider:8 direWolf:10*2 giantBeetle:12' },
        { name: 'The Cave Bear Wakes', by: 'Mitz', line: 'Two cave bears, and each one swings twice. Stack your Fighters.',
          spawns: 'direWolf:0*2 giantBeetle:2 tombSpider:3*2 caveBear:6 warrenHound:7*2 caveSerpent:9 direWolf:10 caveBear:12 deepLeech:13*4' }
      ] },
    { id: 'crypt', name: 'The Old Crypt', gold: 175, by: 'Simz',
      line: 'The crypt under the tavern. Whose idea was it to build on a graveyard?',
      waves: [
        { name: 'Restless Bones', by: 'Simz', line: 'Skeletons are slow. Rot grubs are slower. Neither of them stops.',
          spawns: 'skeleton:0 skeleton:2*2 rotGrub:4*2 skeleton:6 skelArcher:8 skeleton:10*2 rotGrub:12*3' },
        { name: 'Archers on the Stairs', by: 'Mitz', line: 'Skeleton archers shoot from four squares out. Put Rangers in those lanes.',
          spawns: 'skelArcher:0 skeleton:1*2 skelArcher:3 rotGrub:4*3 skeleton:5 skelArcher:7*2 skeleton:9*2 ghoul:11' },
        { name: 'Ghouls in the Ossuary', by: 'Simz', line: 'A ghoul’s claws can paralyse. A frozen hero loses a turn.',
          spawns: 'ghoul:0 skeleton:1*2 ghoul:3 shadeWisp:5 skelArcher:6 ghoul:7*2 shadeWisp:9 skeleton:10*2 ghoul:12' },
        { name: 'The Crypt Guard', by: 'Mitz', line: 'Halberds reach two squares. Bone Knights shrug off steel.',
          spawns: 'boneKnight:0 skeleton:1*2 cryptWarden:3 skelArcher:4*2 boneKnight:6 ghoul:7 shadeWisp:8*2 cryptWarden:10 skeleton:11*3' },
        { name: 'The Shade of Grelminar', by: 'Simz', line: 'The old sorcerer himself. He heals, and he calls up wisps to fight for him.',
          spawns: 'skeleton:0*3 ghoul:2 skelArcher:3*2 boneKnight:5 shade:7 cryptWarden:8 shadeWisp:9*2 ghoul:11*2 skeleton:13*3' }
      ] },
    { id: 'vaults', name: 'The Wine Vaults', map: 'pillars', gold: 150, by: 'Mitz',
      line: 'Smugglers have been using the wine vaults. The pillars are older than the tavern, and very much in the way.',
      waves: [
        { name: "Smugglers' Run", by: 'Mitz', line: 'Pillars block the way and the view. Monsters walk round them, and nobody shoots through them.',
          spawns: 'goblin:0*2 kobold:1 brigand:3 goblin:4*2 brigand:6 kobold:7*2 brigand:9*2 goblin:11*2' },
        { name: 'Archers in the Racks', by: 'Simz', line: 'An archer behind a pillar cannot hit you, and you cannot hit it. Wait for it to step out.',
          spawns: 'goblinArcher:0 brigand:1*2 brigandArcher:3 goblinArcher:4*2 brigand:6*2 brigandArcher:8 orcRaider:9*3 brigand:11*2' },
        { name: 'Rats in the Barrels', by: 'Mitz', line: 'Everything that lived in the barrels has had enough of the smugglers.',
          spawns: 'direRat:0*3 warrenHound:2*2 direRat:3*2 orcRaider:5*2 warrenHound:7*2 caveBat:8*2 orcRaider:10*3 direRat:12*4' },
        { name: 'The Cellar Gang', by: 'Simz', line: 'The mage throws lightning from four squares out. A pillar between you is the best armour in the vaults.',
          spawns: 'brigand:0*2 orc:2 brigandArcher:3*2 renegadeMage:5 orc:6*2 brigand:8 goblinShaman:9 brigandArcher:10*2 orc:12' },
        { name: 'The Muscle', by: 'Mitz', line: 'The smugglers brought an ogre. Then they brought another one.',
          spawns: 'orc:0*2 brigand:1*2 brigandArcher:3 ogre:5 orcRaider:6*3 renegadeMage:8 ogre:10 brigand:11*2 orcChampion:13 orcRaider:14*3' }
      ] },
    { id: 'road', name: 'The Warband Road', gold: 200, by: 'Mitz',
      line: 'Bandits on the road, orcs behind them, and a priest nobody trusts.',
      waves: [
        { name: 'Highwaymen', by: 'Mitz', line: 'Your money or your life. They would prefer both.',
          spawns: 'brigand:0 brigand:2*2 brigandArcher:4 brigand:6 brigandArcher:8*2 brigand:10*2' },
        { name: 'Orcs on the Road', by: 'Simz', line: 'The raiders are quick. The big ones with axes hit hardest.',
          spawns: 'orcRaider:0*2 orc:2 brigand:3 orcRaider:5*2 orc:7 brigandArcher:8 orcRaider:10*2 orc:12' },
        { name: 'The Marsh Path', by: 'Mitz', line: 'Lizardfolk spears reach two squares, and the mage throws lightning from four.',
          spawns: 'lizardfolk:0 lizardfolk:2 orcRaider:3*2 renegadeMage:5 lizardfolk:7*2 brigandArcher:8 orc:10 renegadeMage:12' },
        { name: 'The Dark Chapel', by: 'Simz', line: 'The Fallen Priest patches up the monsters around him. Take him down first.',
          spawns: 'fallenPriest:0 orc:1*2 brigand:3*2 renegadeMage:4 lizardfolk:6 fallenPriest:8 orcRaider:9*3 ogre:11' },
        { name: 'The Warband', by: 'Mitz', line: 'Champions swing twice, the ogre swings hard, and everyone is angry.',
          spawns: 'orcRaider:0*3 orc:2*2 fallenPriest:4 orcChampion:6 brigandArcher:7*2 ogre:9 renegadeMage:10 orc:11*2 orcChampion:13 orcRaider:14*3' }
      ] },
    { id: 'flooded', name: 'The Sunken Chapel', map: 'flooded', gold: 200, by: 'Simz',
      line: 'The chapel under the crypt has flooded. The water is cold, black, and not empty.',
      waves: [
        { name: 'Black Water', by: 'Simz', line: 'Wading is slow, so walkers go round the water if they can. Most of them can.', doors: [1, 2, 3],
          spawns: 'skeleton:0*2 ghoul:2 deepLeech:3*2 skeleton:4*2 caveSerpent:6 skeleton:8*2 ghoul:9 deepLeech:11*3' },
        { name: 'The Font', by: 'Mitz', line: 'The old font still blesses the square beside it. Undead that start a turn there burn.', doors: [1, 2, 3],
          spawns: 'skeleton:0*3 skelArcher:2 ghoul:3*2 lizardfolk:5 skeleton:6*3 skelArcher:8*2 ghoul:10*2 lizardfolk:12' },
        { name: 'The Side Doors', by: 'Simz', line: 'The side doors have rusted open. Watch the corners.',
          spawns: 'ghoul:0@0 ghoul:0@4 skeleton:1*3 lizardfolk:3*2 shadeWisp:5*2 skelArcher:7@0 skelArcher:7@4 ghoul:8*3 wight:10 caveSerpent:11*2' },
        { name: 'Drowned Knights', by: 'Mitz', line: 'Bone Knights in rusted mail, still marching. Steel barely dents them.',
          spawns: 'boneKnight:0*2 skeleton:1*3 wight:3 cryptWarden:5*2 ghoul:6*3 boneKnight:8@0 wight:9*2 shadeWisp:10*2 skeleton:12*3' },
        { name: 'High Water', by: 'Simz', line: 'Everything that was under the water, all at once.',
          spawns: 'wight:0*2 skeleton:1*3 boneTitan:3 wraith:4 ghoul:6@0 ghoul:6@4 cryptWarden:7*2 wight:9*3 wraith:10*2 boneTitan:12 skeleton:13*4' }
      ] },
    { id: 'barrow', name: 'The Barrow', gold: 250, by: 'Simz',
      line: 'The barrow kings are waking up. Bring torches. Bring Wizards.',
      waves: [
        { name: 'Barrow Mist', by: 'Simz', line: 'Wights drink the life they take. Hit them hard and fast.',
          spawns: 'ghoul:0*2 skeleton:2*2 wight:4 ghoul:6 skelArcher:7*2 wight:9 skeleton:10*3' },
        { name: 'The Wights Walk', by: 'Mitz', line: 'More wights. Someone has been opening tombs.',
          spawns: 'wight:0 wight:2 ghoul:3*2 skelArcher:5 wight:7*2 skeleton:8*3 boneKnight:10' },
        { name: 'Cold Hands', by: 'Simz', line: 'Wraiths fly over your first hero, drink life and laugh at swords. Wizards, please.',
          spawns: 'wraith:0 skeleton:1*2 wight:3 wraith:5 ghoul:6*2 wraith:8 skelArcher:9*2 wight:11' },
        { name: 'The Bone Titan', by: 'Mitz', line: 'A skeleton the size of a barn, swinging a thigh bone. Steel barely scratches it.',
          spawns: 'boneTitan:0 skeleton:1*3 wraith:3 wight:5 boneTitan:7 ghoul:8*2 cryptWarden:10 wraith:11' },
        { name: 'The Barrow Lich', by: 'Simz', line: 'The barrow king. Deathbolts from four squares, and a fresh skeleton every third turn.',
          spawns: 'wight:0*2 skeleton:1*3 wraith:3 barrowLich:5 boneTitan:7 ghoul:8*2 wight:10 wraith:12 skeleton:13*3' }
      ] },
    { id: 'bridge', name: 'The Long Drop', map: 'bridge', gold: 250, by: 'Mitz',
      line: 'A chasm under the cellar, one narrow bridge, and a great many wings.',
      waves: [
        { name: 'The Bridge', by: 'Mitz', line: 'Walkers have to cross on the bridge in the middle row. Bats do not bother.',
          spawns: 'goblin:0*2 kobold:2*2 caveBat:3 caveBat:5*2 warrenHound:6 goblin:7*3 caveBat:8*2 orcRaider:9*2 caveBat:11*2' },
        { name: 'High Ground', by: 'Simz', line: 'A hero on a raised ledge gets +2 to hit. Shoot across the chasm from there.',
          spawns: 'orcRaider:0*2 goblinArcher:2*2 caveBat:3*3 orc:5*2 warrenHound:6*2 caveBat:8*3 orc:10*2 direWolf:12*2' },
        { name: 'Gargoyle Roost', by: 'Mitz', line: 'Gargoyles fly straight over the chasm, and they are rude about swords.',
          spawns: 'gargoyle:0 caveBat:1*3 orc:3*2 gargoyle:5 lizardfolk:6 caveBat:7*3 gargoyle:9 orcRaider:10*3' },
        { name: 'Cold Wind', by: 'Simz', line: 'Wraiths drift over the drop as if it was not there. Wizards, please.',
          spawns: 'wraith:0 gargoyle:2 orc:3*2 wraith:5 caveBat:6*3 ogre:8 gargoyle:9*2 wraith:11' },
        { name: 'The Crossing', by: 'Mitz', line: 'Everything at once, on foot and on wings.',
          spawns: 'gargoyle:0*2 orcChampion:2 caveBat:3*4 wraith:5 ogre:6 gargoyle:8*2 wraith:9*2 orcChampion:11 caveBat:12*4 ogre:13' }
      ] },
    { id: 'halls', name: 'The Deep Halls', gold: 300, by: 'Mitz',
      line: 'Below everything, the old halls. Stone that walks, and dark that eats.',
      waves: [
        { name: 'Embers', by: 'Mitz', line: 'Ember wisps kindle new wisps. Glooms split in two when hurt. It gets crowded.',
          spawns: 'emberWisp:0 gloom:2 emberWisp:4*2 gloom:6 emberWisp:8 gloom:10*2' },
        { name: 'Stone Wings', by: 'Simz', line: 'Gargoyles: flying, made of stone, and rude about swords.',
          spawns: 'gargoyle:0 emberWisp:2 gargoyle:3*2 gloom:5 gargoyle:7 emberWisp:9*2 gargoyle:11' },
        { name: 'The Iron Sentinels', by: 'Mitz', line: 'They repair themselves every turn. Focus your fire.',
          spawns: 'ironSentinel:0 gargoyle:2 ironSentinel:4 gloom:5*2 emberWisp:7*2 ironSentinel:9 gargoyle:11*2' },
        { name: 'Clay and Dark', by: 'Simz', line: 'A golem, and something with too many eyes. Try not to look at it for long.',
          spawns: 'clayGolem:0 gloom:2 ironSentinel:4 deepHorror:6 emberWisp:7*2 clayGolem:9 gargoyle:10*2 gloom:12' },
        { name: 'The Stone Colossus', by: 'Mitz', line: 'The biggest thing under the tavern. Two fists, and swords barely chip it.',
          spawns: 'gargoyle:0*2 ironSentinel:2 clayGolem:4 stoneColossus:6 emberWisp:7*3 deepHorror:9 gloom:10*2 ironSentinel:12 gargoyle:13*2' }
      ] }
  ];
  /* Maps. Each string is one row of the mat (a lane), read from the tavern on the left to the dungeon on the right.
       .  floor
       #  pillar: nothing can stand there, and it blocks the line of sight along its row
       ~  water or mud: difficult ground, walkers take twice as long to cross it
       ^  high ground: a hero standing here gets +2 to hit
       +  holy ground: undead that start a turn here take 2 radiant damage
       o  pit: walkers go round, flyers cross; no hero can stand on it
       D  door: monsters come in here; no hero can stand on it
          (space) outside the mat
     Doors are numbered in reading order, row by row. */
  const MAPS = {
    classic: { name: 'The Cellar Floor', rows: [
      '.........D',
      '.........D',
      '.........D',
      '.........D',
      '.........D'] },
    pillars: { name: 'The Pillared Cellar', rows: [
      '....#....D',
      '.......#.D',
      '.........D',
      '.......#.D',
      '....#....D'] },
    flooded: { name: 'The Flooded Crypt', rows: [
      '......D   ',
      '...~~....D',
      '...~~+...D',
      '...~~....D',
      '......D   '] },
    bridge: { name: 'The Chasm Bridge', rows: [
      '...oooo..D',
      '..^oooo..D',
      '.........D',
      '..^oooo..D',
      '...oooo..D'] }
  };
  const PASS_WALK = '.~^+D', PASS_FLY = '.~^+Do', PLACEABLE = '.~^+', SIGHT_BLOCK = '# ';
  const MAP_BY_ID = {}, BATTLE_BY_ID = {};

  function parseSpawns(str) {
    const out = [];
    for (const tok of str.split(/\s+/)) {
      if (!tok) continue;
      const m = /^([A-Za-z]+):(\d+)(?:\*(\d+))?(?:@(\d+))?$/.exec(tok);
      if (!m || !MONSTERS[m[1]]) throw new Error('Hold the Line: bad spawn token "' + tok + '"');
      out.push({ type: m[1], at: +m[2], count: m[3] ? +m[3] : 1, door: m[4] != null ? +m[4] : null });
    }
    return out;
  }

  // cost of getting from every square to the tavern: moving into a square costs 1, or 2 for walkers in water
  function field(map, pass, wade) {
    const { w, h, rows } = map;
    const dist = Array.from({ length: h }, () => new Array(w).fill(Infinity));
    const cost = (l, q) => (wade && rows[l][q] === '~') ? 2 : 1;
    const done = Array.from({ length: h }, () => new Array(w).fill(false));
    for (let l = 0; l < h; l++) if (pass.indexOf(rows[l][0]) >= 0) dist[l][0] = 1;
    for (;;) { // Dijkstra by scanning: the mats are tiny
      let bl = -1, bq = -1, bd = Infinity;
      for (let l = 0; l < h; l++) for (let q = 0; q < w; q++) if (!done[l][q] && dist[l][q] < bd) { bd = dist[l][q]; bl = l; bq = q; }
      if (bl < 0) break;
      done[bl][bq] = true;
      for (const [dl, dq] of STEPS) {
        const l = bl + dl, q = bq + dq;
        if (l < 0 || l >= h || q < 0 || q >= w || pass.indexOf(rows[l][q]) < 0) continue;
        const nd = bd + cost(bl, bq);
        if (nd < dist[l][q]) dist[l][q] = nd;
      }
    }
    // the next square from each square: toward the tavern first, then up, down, back; first cheapest wins
    const next = Array.from({ length: h }, (_, l) => Array.from({ length: w }, (_, q) => {
      if (!isFinite(dist[l][q])) return null;
      let best = null, bc = Infinity;
      if (q === 0) { best = EXIT; bc = 1; }
      for (const [dl, dq] of STEPS) {
        const l2 = l + dl, q2 = q + dq;
        if (l2 < 0 || l2 >= h || q2 < 0 || q2 >= w || !isFinite(dist[l2][q2])) continue;
        const c = cost(l2, q2) + dist[l2][q2];
        if (c < bc) { best = { lane: l2, sq: q2 }; bc = c; }
      }
      return best;
    }));
    return { dist, next };
  }
  const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];
  const EXIT = { exit: true };

  function compileMap(id, src) {
    const rows = src.rows, h = rows.length, w = rows[0].length;
    if (rows.some(r => r.length !== w)) throw new Error('Hold the Line: map ' + id + ' has rows of different lengths');
    const doors = [];
    for (let l = 0; l < h; l++) for (let q = 0; q < w; q++) if (rows[l][q] === 'D') doors.push({ lane: l, sq: q });
    const map = { id, name: src.name, rows, w, h, doors };
    const walk = field(map, PASS_WALK, true), fly = field(map, PASS_FLY, false);
    map.nextWalk = walk.next; map.nextFly = fly.next; map.distWalk = walk.dist;
    doors.forEach((dr, i) => { if (!isFinite(walk.dist[dr.lane][dr.sq])) throw new Error('Hold the Line: door ' + i + ' of map ' + id + ' has no way to the tavern'); });
    if (!doors.length) throw new Error('Hold the Line: map ' + id + ' has no doors');
    map.plan = src.plan || derivePlan(map);
    return map;
  }

  function rnd(s) {
    let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function d(s, n) { if (s.forced && s.forced.length) return s.forced.shift(); return 1 + Math.floor(rnd(s) * n); }
  function dice(s, n, sides) { let t = 0; for (let i = 0; i < n; i++) t += d(s, sides); return t; }
  function slot(init) { return Math.min(0.97, Math.max(0.03, (24 - init) / 25)); }
  function emit(s, ev) { ev.t = s.now; s.events.push(ev); return ev; }
  const NO_TRAITS = {};
  function traits(u) { return u.kind === 'monster' ? MONSTERS[u.type].traits : NO_TRAITS; }
  function battle(s) { return BATTLE_BY_ID[s.battle] || BATTLES[0]; }
  function mapOf(s) { return MAP_BY_ID[battle(s).map]; }
  function cellAt(s, lane, sq) { const m = mapOf(s); return lane >= 0 && lane < m.h && sq >= 0 && sq < m.w ? m.rows[lane][sq] : ' '; }

  function newGame(seed, battleId) {
    seed = (seed >>> 0) || 1;
    const b = BATTLE_BY_ID[battleId] || BATTLES[0];
    return {
      v: 3, battle: b.id, seed, rng: seed, time: 0, now: 0, round: 0, nextRoundAt: 0,
      gold: b.gold, lives: LIVES, maxLives: LIVES, phase: 'running',
      wave: -1, waveActive: false, nextWaveRound: 1 + PREP_ROUNDS, pending: [],
      units: [], nextId: 1, events: [], ready: {},
      stats: { kills: 0, leaks: 0, crits: 0, fumbles: 0, rolls: 0, placed: 0, fallen: 0, healed: 0, charges: 0, recalled: 0 }
    };
  }

  function unitAt(s, lane, sq) {
    for (const u of s.units) if (u.alive && u.lane === lane && u.sq === sq) return u;
    return null;
  }
  function monsterAt(s, lane, sq) { const u = unitAt(s, lane, sq); return u && u.kind === 'monster' ? u : null; }
  // nothing solid between two squares of the same row (pillars and the edge of the mat block the view)
  function clearRow(s, lane, a, b) {
    const m = mapOf(s), lo = Math.min(a, b), hi = Math.max(a, b);
    for (let q = lo + 1; q < hi; q++) if (SIGHT_BLOCK.indexOf(m.rows[lane][q]) >= 0) return false;
    return true;
  }
  // the nearest monster ahead in a row (toward the dungeon) that a hero there can see
  function nearestAhead(s, lane, sq) {
    let best = null;
    for (const u of s.units) if (u.alive && u.kind === 'monster' && u.lane === lane && u.sq > sq && (!best || u.sq < best.sq)) best = u;
    return best && clearRow(s, lane, sq, best.sq) ? best : null;
  }
  // where a monster goes next: a square, the tavern (exit), or nowhere
  function stepOf(s, u) { const m = mapOf(s); return (traits(u).flying ? m.nextFly : m.nextWalk)[u.lane][u.sq]; }
  // the hero a monster can hit: whoever stands on the square it wants, or the nearest hero ahead in its row within reach
  function heroInReach(s, m, range) {
    const nx = stepOf(s, m);
    let best = null;
    if (nx && !nx.exit) { const u = unitAt(s, nx.lane, nx.sq); if (u && u.kind === 'hero') best = u; }
    for (const u of s.units) {
      if (!u.alive || u.kind !== 'hero' || u.lane !== m.lane || u.sq >= m.sq || m.sq - u.sq > range) continue;
      if (!clearRow(s, m.lane, u.sq, m.sq)) continue;
      if (!best || (best.lane === m.lane && u.sq > best.sq)) best = u;
    }
    return best;
  }
  function free(s, lane, sq) {
    const m = mapOf(s);
    return lane >= 0 && lane < m.h && sq >= 1 && sq < m.w && PASS_WALK.indexOf(m.rows[lane][sq]) >= 0 && !unitAt(s, lane, sq);
  }

  function addUnit(s, kind, type, lane, sq) {
    const st = kind === 'hero' ? HEROES[type] : MONSTERS[type];
    const u = { id: s.nextId++, kind, type, lane, sq, hp: st.hp, maxHp: st.hp, ac: st.ac,
      init: d(s, 20) + st.init, acc: 0, turns: 0, charge: 0, actAt: 0, actedRound: 0, alive: true,
      status: {}, hopped: false, split: false, minor: false, made: 0 };
    const roundStart = s.nextRoundAt - ROUND;
    u.actAt = roundStart + slot(u.init) * ROUND;
    u.actedRound = (s.round > 0 && u.actAt > s.now) ? s.round - 1 : s.round;
    s.units.push(u);
    return u;
  }

  /* Statuses: timed conditions on any unit, counted in the owner's own turns. */
  const STATUSES = {
    paralysed: { bad: true, word: 'PARALYSED' }, // loses its next turn
    slowed:    { bad: true, word: 'SLOWED' },    // moves at half speed
    poisoned:  { bad: true, word: 'POISONED' }   // 1d4 poison damage at the start of each turn
  };
  function hasStatus(u, k) { return (u.status[k] || 0) > 0; }
  function addStatus(s, u, k, turns, from) {
    if (!STATUSES[k]) throw new Error('Hold the Line: unknown status ' + k);
    u.status[k] = Math.max(u.status[k] || 0, turns);
    emit(s, { type: 'status', id: u.id, status: k, turns, from: from ? from.id : 0 });
  }
  function clearBad(u) { let any = false; for (const k in u.status) if (STATUSES[k] && STATUSES[k].bad && u.status[k] > 0) { u.status[k] = 0; any = true; } return any; }
  // the start of a unit's own turn: poison bites, slows take hold, paralysis costs the turn
  function statusStart(s, u) {
    const st = u.status;
    u.slowNow = (st.slowed || 0) > 0;
    if (u.slowNow) st.slowed--;
    if ((st.poisoned || 0) > 0) {
      st.poisoned--;
      const dmg = dice(s, 1, 4), killed = hurt(u, dmg);
      emit(s, { type: 'poison', id: u.id, dmg, killed });
      if (killed) { died(s, u, null); return true; }
    }
    if ((st.paralysed || 0) > 0) { st.paralysed--; emit(s, { type: 'stunned', id: u.id }); return true; }
    return false;
  }

  function startRound(s) {
    const roundStart = s.nextRoundAt;
    s.round++; s.nextRoundAt += ROUND; s.now = roundStart;
    for (const u of s.units) if (u.alive) u.actAt = roundStart + slot(u.init) * ROUND;
    emit(s, { type: 'round', round: s.round });
    if (s.phase !== 'running') return;
    if (s.round === 1) emit(s, { type: 'incoming', rounds: PREP_ROUNDS, battle: s.battle });
    if (!s.waveActive && s.round >= s.nextWaveRound && s.wave < battle(s).waves.length - 1) beginWave(s);
    spawnDue(s);
  }

  function doorPool(s, w) { return w.doors ? w.doors.slice() : mapOf(s).doors.map((_, i) => i); }

  function beginWave(s) {
    const b = battle(s);
    s.wave++; s.waveActive = true;
    const w = b.waves[s.wave], pool = doorPool(s, w);
    const used = {};
    for (const sp of w.parsed) for (let k = 0; k < sp.count; k++) {
      const r = s.round + sp.at;
      const taken = used[r] || (used[r] = []);
      let door = sp.door;
      if (door == null) {
        let open = pool.filter(i => taken.indexOf(i) < 0);
        if (!open.length) open = pool.slice();
        door = open[Math.floor(rnd(s) * open.length)];
      }
      taken.push(door);
      s.pending.push({ round: r, type: sp.type, door, pool });
    }
    emit(s, { type: 'wave', index: s.wave, total: b.waves.length, name: w.name, by: w.by, line: w.line });
  }

  function spawnDue(s) {
    const m = mapOf(s), keep = [];
    for (const p of s.pending) {
      if (p.round > s.round) { keep.push(p); continue; }
      let door = m.doors[p.door];
      if (unitAt(s, door.lane, door.sq)) {
        const open = p.pool.filter(i => !unitAt(s, m.doors[i].lane, m.doors[i].sq));
        if (!open.length) { p.round = s.round + 1; keep.push(p); continue; }
        door = m.doors[open[Math.floor(rnd(s) * open.length)]];
      }
      const u = addUnit(s, 'monster', p.type, door.lane, door.sq);
      u.actedRound = s.round; // dropped onto the mat this round, acts from next round
      emit(s, { type: 'spawn', id: u.id, kind: 'monster', unitType: u.type, lane: door.lane, sq: door.sq, hp: u.hp, maxHp: u.maxHp, how: 'arrive' });
    }
    s.pending = keep;
  }

  function step(s, dt) {
    const end = s.time + dt;
    while (s.phase === 'running' && s.nextRoundAt <= end + 1e-9) { // once the battle is over the clock runs on for the animations only
      processDue(s, s.nextRoundAt - 1e-6);
      s.time = s.nextRoundAt;
      startRound(s);
    }
    s.time = end;
    processDue(s, end);
    s.now = s.time;
    checkWave(s);
    let dead = false;
    for (const u of s.units) if (!u.alive) { dead = true; break; }
    if (dead) s.units = s.units.filter(u => u.alive);
  }

  function processDue(s, t) {
    if (s.phase !== 'running') return;
    for (;;) {
      let next = null;
      for (const u of s.units) {
        if (!u.alive || u.actedRound >= s.round || u.actAt > t + 1e-9) continue;
        if (!next || u.actAt < next.actAt || (u.actAt === next.actAt && u.id < next.id)) next = u;
      }
      if (!next) return;
      next.actedRound = s.round;
      s.now = next.actAt;
      if (next.kind === 'hero') heroAct(s, next); else monsterAct(s, next);
      if (s.phase !== 'running') return;
    }
  }

  function heroAct(s, u) {
    if (statusStart(s, u)) return;
    const st = HEROES[u.type];
    if (st.income) {
      u.turns++;
      if (u.turns % st.income.every === 0) { s.gold += st.income.gold; emit(s, { type: 'income', id: u.id, amount: st.income.gold }); }
      return;
    }
    if (st.heal && healNear(s, u, st.heal)) return;
    if (st.targeting === 'charge') { charge(s, u, st); return; }
    let target;
    if (st.targeting === 'adjacent') target = monsterAt(s, u.lane, u.sq + 1) || monsterAt(s, u.lane, u.sq - 1);
    else if (st.targeting === 'around') target = bestAround(s, u);
    else {
      target = nearestAhead(s, u.lane, u.sq);
      if (!target && st.targeting === 'lanes') {
        const l = nearestAhead(s, u.lane - 1, u.sq), r = nearestAhead(s, u.lane + 1, u.sq);
        target = !l ? r : !r ? l : (r.sq < l.sq ? r : l);
      }
    }
    if (!target) return;
    if (st.spell) {
      u.charge++;
      if (u.charge >= st.spell.every) { u.charge = 0; fireball(s, u, target, st.spell); return; }
    }
    let atk = st.attack;
    if (st.sneak && flanked(s, target, u)) atk = Object.assign({}, atk, { extra: [st.sneak.n, st.sneak.d], sneak: true });
    attack(s, u, target, atk);
  }

  const near = (a, b) => Math.abs(a.lane - b.lane) <= 1 && Math.abs(a.sq - b.sq) <= 1;

  // Cleric: Healing Word on the most hurt hero within reach (itself included); paralysis counts as hurt
  function healNear(s, u, hl) {
    let best = null, need = 0;
    for (const h of s.units) {
      if (!h.alive || h.kind !== 'hero' || Math.abs(h.lane - u.lane) > hl.reach || Math.abs(h.sq - u.sq) > hl.reach) continue;
      const n = (h.maxHp - h.hp) + (hasStatus(h, 'paralysed') ? 8 : 0);
      if (n > need) { best = h; need = n; }
    }
    if (!best || need < 4) return false; // not worth a turn: Sacred Flame instead
    const amount = Math.min(dice(s, hl.n, hl.d) + hl.mod, best.maxHp - best.hp);
    const cured = hasStatus(best, 'paralysed');
    best.hp += amount; clearBad(best); s.stats.healed += amount;
    emit(s, { type: 'cure', from: u.id, id: best.id, amount, cured });
    return true;
  }

  // Sneak Attack needs another hero next to the target
  function flanked(s, m, by) {
    for (const h of s.units) if (h.alive && h.kind === 'hero' && h !== by && near(h, m)) return true;
    return false;
  }
  // Rogue: any monster in the eight squares around it; a Sneak Attack first, then the weakest
  function bestAround(s, u) {
    let best = null, score = -Infinity;
    for (const m of s.units) {
      if (!m.alive || m.kind !== 'monster' || !near(m, u)) continue;
      const sc = (flanked(s, m, u) ? 1000 : 0) - m.hp;
      if (sc > score) { best = m; score = sc; }
    }
    return best;
  }

  // Barbarian: waits until a monster is ahead in its row, then rages, charges and swings at everything
  // in the 3×3 around that monster with advantage. The charge spends it: it leaves the mat, it does not die.
  function charge(s, u, st) {
    const target = nearestAhead(s, u.lane, u.sq);
    if (!target) return;
    let dest = target.sq - 1;
    if (dest !== u.sq && unitAt(s, u.lane, dest) && free(s, u.lane, target.sq + 1)) dest = target.sq + 1; // vaults it
    emit(s, { type: 'charge', id: u.id, from: u.sq, to: dest, target: target.id });
    const around = s.units.filter(m => m.alive && m.kind === 'monster' && near(m, target));
    around.sort((a, b) => (a === target ? -1 : b === target ? 1 : a.id - b.id));
    for (const m of around) if (m.alive) attack(s, u, m, st.attack);
    u.alive = false; s.stats.charges++;
    emit(s, { type: 'spent', id: u.id });
  }

  /* Monster abilities, as hooks that run in this order. A new ability is a new entry in one of these lists. */
  const TURN_START = [ // before anything else on its turn; true = it died
    function holyGround(s, u) {
      if (!traits(u).undead || cellAt(s, u.lane, u.sq) !== '+') return false;
      const killed = hurt(u, 2);
      emit(s, { type: 'burn', id: u.id, dmg: 2, killed });
      if (killed) died(s, u, null);
      return killed;
    },
    function regenerate(s, u) {
      const v = traits(u).regen;
      if (v && u.hp < u.maxHp) { const amount = Math.min(v, u.maxHp - u.hp); u.hp += amount; emit(s, { type: 'regen', id: u.id, amount }); }
      return false;
    }
  ];
  const BEFORE_ACT = [ // instead of moving or attacking; true = the turn is used
    function callHelp(s, u) { const sm = traits(u).summon; return !!(sm && !u.minor && u.made < sm.max && u.turns % sm.every === 0 && summon(s, u, sm.type)); },
    function mendNearby(s, u) { const md = traits(u).mend; return !!(md && u.turns % md.every === 0 && mend(s, u, md)); }
  ];
  const AFTER_HIT = [ // the attacker's, when its blow lands
    function drain(s, a, t, dmg) {
      if (!traits(a).drain || !a.alive || a.hp >= a.maxHp || dmg < 2) return;
      const amount = Math.min(Math.floor(dmg / 2), a.maxHp - a.hp);
      a.hp += amount;
      emit(s, { type: 'regen', id: a.id, amount, drain: true });
    }
  ];
  const AFTER_WOUND = [ // the attacker's, when the target survives
    function paralyse(s, a, t) {
      if (!traits(a).paralyse || t.kind !== 'hero' || hasStatus(t, 'paralysed')) return;
      const save = d(s, 20); // DC 12 save to shake it off
      if (save < 12) { t.status.paralysed = 1; emit(s, { type: 'paralyse', id: t.id, from: a.id, roll: save }); }
    }
  ];
  const ON_HURT = [ // the target's, when it survives a wound
    function split(s, t) { if (t.kind === 'monster') maybeSplit(s, t); }
  ];

  function monsterAct(s, u) {
    const st = MONSTERS[u.type], tr = st.traits, atk = st.attack, m = mapOf(s);
    u.turns++;
    for (const hook of TURN_START) if (hook(s, u)) return;
    if (statusStart(s, u)) return;
    for (const hook of BEFORE_ACT) if (hook(s, u)) return;

    const target = heroInReach(s, u, atk.range);
    if (target) {
      if (tr.flying && !u.hopped) {
        const nx = stepOf(s, u);
        if (nx && !nx.exit && nx.lane === target.lane && nx.sq === target.sq) {
          const after = m.nextFly[target.lane][target.sq];
          if (after && after.exit) { u.hopped = true; leak(s, u); return; }
          if (after && !unitAt(s, after.lane, after.sq)) {
            u.hopped = true; u.acc = 0;
            const from = u.sq, fromLane = u.lane; u.sq = after.sq; u.lane = after.lane;
            emit(s, { type: 'move', id: u.id, from, to: u.sq, leap: true, lane: u.lane, fromLane });
            return;
          }
        }
      }
      const times = tr.multi || 1;
      for (let i = 0; i < times && target.alive && u.alive; i++) attack(s, u, target, atk);
      return;
    }
    u.acc += st.speed * (u.slowNow ? 0.5 : 1);
    let steps = 0;
    while (steps < 2) {
      const nx = stepOf(s, u);
      if (!nx) break;
      const cost = (!tr.flying && !nx.exit && m.rows[nx.lane][nx.sq] === '~') ? 2 : 1;
      if (u.acc < cost - 1e-9) break;
      if (nx.exit) { leak(s, u); return; }
      if (unitAt(s, nx.lane, nx.sq)) { u.acc = Math.min(u.acc, cost); break; } // queued behind another unit
      u.acc -= cost; steps++;
      const from = u.sq, fromLane = u.lane; u.sq = nx.sq; u.lane = nx.lane;
      emit(s, { type: 'move', id: u.id, from, to: u.sq, step: steps, lane: u.lane, fromLane });
      if (heroInReach(s, u, atk.range)) break;
    }
  }

  function leak(s, u) {
    u.alive = false; s.lives--; s.stats.leaks++;
    emit(s, { type: 'leak', id: u.id, lane: u.lane });
    if (s.lives <= 0) { s.lives = 0; s.phase = 'lost'; emit(s, { type: 'defeat' }); }
  }

  function attack(s, a, t, atk) {
    let roll = d(s, 20), low = 0; s.stats.rolls++;
    if (atk.reckless) { low = d(s, 20); if (low > roll) { const x = roll; roll = low; low = x; } } // advantage: keep the higher
    const crit = roll === 20, fumble = roll === 1;
    if (a.kind === 'hero') { if (crit) s.stats.crits++; if (fumble) s.stats.fumbles++; }
    const high = a.kind === 'hero' && cellAt(s, a.lane, a.sq) === '^';
    const bonus = atk.bonus + (high ? 2 : 0);
    const total = roll + bonus;
    const hit = !fumble && (crit || total >= t.ac);
    let dmg = 0, killed = false, resisted = false;
    const holy = !!(atk.holy && traits(t).undead);
    if (hit) {
      const k = (crit ? 2 : 1) * (holy ? 2 : 1);
      dmg = dice(s, atk.n * k, atk.d) + atk.mod;
      if (atk.extra) dmg += dice(s, atk.extra[0] * (crit ? 2 : 1), atk.extra[1]);
      dmg = Math.max(1, dmg);
      if (a.kind === 'hero' && !atk.magic && traits(t).resist) { dmg = Math.max(1, Math.floor(dmg / 2)); resisted = true; }
      killed = hurt(t, dmg);
    }
    emit(s, { type: 'attack', from: a.id, to: t.id, side: a.kind, kind: atk.kind, fx: atk.fx, name: atk.name,
      roll, low, bonus, total, ac: t.ac, hit, crit, fumble, dmg, killed, resisted, holy, sneak: !!atk.sneak, high });
    if (!hit) return;
    for (const hook of AFTER_HIT) hook(s, a, t, dmg);
    if (killed) { died(s, t, a); return; }
    for (const hook of AFTER_WOUND) hook(s, a, t, dmg);
    for (const hook of ON_HURT) hook(s, t);
  }

  function fireball(s, u, center, sp) {
    const dmg = dice(s, sp.n, sp.d), cl = center.lane, cs = center.sq;
    emit(s, { type: 'fireball', from: u.id, lane: cl, sq: cs, dmg, name: sp.name });
    const caught = s.units.filter(m => m.alive && m.kind === 'monster' && Math.abs(m.lane - cl) <= sp.radius && Math.abs(m.sq - cs) <= sp.radius);
    for (const m of caught) {
      const roll = d(s, 20), total = roll + MONSTERS[m.type].dexSave, saved = total >= sp.dc;
      const dd = saved ? Math.floor(dmg / 2) : dmg;
      const killed = dd > 0 ? hurt(m, dd) : false;
      emit(s, { type: 'save', from: u.id, to: m.id, roll, total, dc: sp.dc, saved, dmg: dd, killed });
      if (killed) died(s, m, u); else for (const hook of ON_HURT) hook(s, m);
    }
  }

  function hurt(t, dmg) {
    t.hp -= dmg;
    if (t.hp <= 0 && t.alive) { t.hp = 0; t.alive = false; return true; }
    return false;
  }

  function died(s, t, by) {
    let bounty = 0;
    if (t.kind === 'monster') {
      bounty = MONSTERS[t.type].bounty;
      if (t.minor) bounty = Math.floor(bounty / 2);
      s.gold += bounty; s.stats.kills++;
    } else s.stats.fallen++;
    emit(s, { type: 'death', id: t.id, by: by ? by.id : 0, bounty });
  }

  // squares a monster can put a new body into: behind it first, then the rows either side
  function spotsNear(m) {
    return [[m.lane, m.sq + 1], [m.lane - 1, m.sq], [m.lane + 1, m.sq], [m.lane - 1, m.sq + 1], [m.lane + 1, m.sq + 1]];
  }

  function maybeSplit(s, m) {
    if (!traits(m).split || m.split || !m.alive || m.hp * 2 > m.maxHp) return;
    m.split = true;
    const half = Math.floor(m.hp / 2);
    if (half < 1) return;
    for (const [l, q] of spotsNear(m)) {
      if (!free(s, l, q)) continue;
      m.hp -= half;
      const c = addUnit(s, 'monster', m.type, l, q);
      c.hp = half; c.maxHp = m.maxHp; c.split = true; c.minor = true; c.actedRound = s.round;
      emit(s, { type: 'spawn', id: c.id, kind: 'monster', unitType: c.type, lane: l, sq: q, hp: c.hp, maxHp: c.maxHp, how: 'split', from: m.id });
      return;
    }
  }

  function summon(s, u, type) {
    for (const [l, q] of spotsNear(u)) {
      if (!free(s, l, q)) continue;
      const m = addUnit(s, 'monster', type, l, q);
      m.minor = true; m.actedRound = s.round; u.made++;
      emit(s, { type: 'summon', id: u.id, made: m.id });
      emit(s, { type: 'spawn', id: m.id, kind: 'monster', unitType: type, lane: l, sq: q, hp: m.hp, maxHp: m.maxHp, how: 'summon', from: u.id });
      return true;
    }
    return false;
  }

  function mend(s, u, md) {
    let best = null;
    for (const m of s.units) {
      if (!m.alive || m.kind !== 'monster' || Math.abs(m.lane - u.lane) > 1 || Math.abs(m.sq - u.sq) > 2) continue;
      if (!best || m.maxHp - m.hp > best.maxHp - best.hp) best = m;
    }
    if (!best || best.maxHp - best.hp < 4) return false;
    const amount = Math.min(dice(s, md.n, md.d), best.maxHp - best.hp);
    best.hp += amount;
    emit(s, { type: 'mend', from: u.id, id: best.id, amount });
    return true;
  }

  function checkWave(s) {
    if (s.phase !== 'running' || !s.waveActive || s.pending.length) return;
    for (const u of s.units) if (u.alive && u.kind === 'monster') return;
    const b = battle(s);
    s.waveActive = false;
    emit(s, { type: 'waveCleared', index: s.wave });
    if (s.wave >= b.waves.length - 1) { s.phase = 'won'; emit(s, { type: 'victory', battle: b.id }); return; }
    for (const u of s.units) {
      if (!u.alive || u.kind !== 'hero') continue;
      clearBad(u);
      if (u.hp < u.maxHp) {
        const amount = Math.ceil((u.maxHp - u.hp) / 2);
        u.hp += amount;
        emit(s, { type: 'heal', id: u.id, amount });
      }
    }
    s.nextWaveRound = s.round + REST_ROUNDS;
    emit(s, { type: 'rest', rounds: REST_ROUNDS, next: s.wave + 1 });
  }

  function placeable(s, lane, sq) { return PLACEABLE.indexOf(cellAt(s, lane, sq)) >= 0; }

  function canPlace(s, type, lane, sq) {
    const h = HEROES[type];
    if (!h) return 'unknown';
    if (s.phase !== 'running') return 'over';
    if (!placeable(s, lane, sq)) return 'off';
    if (unitAt(s, lane, sq)) return 'occupied';
    if (h.recharge && s.round < (s.ready[type] || 0)) return 'recharging';
    if (s.gold < h.cost) return 'gold';
    return null;
  }

  function place(s, type, lane, sq) {
    const why = canPlace(s, type, lane, sq);
    if (why) return why;
    s.now = s.time;
    s.gold -= HEROES[type].cost;
    if (HEROES[type].recharge) s.ready[type] = s.round + HEROES[type].recharge;
    s.stats.placed++;
    const u = addUnit(s, 'hero', type, lane, sq);
    emit(s, { type: 'place', id: u.id, kind: 'hero', unitType: type, lane, sq, hp: u.hp });
    return null;
  }

  // what a hero is worth if called back to the tavern: half of what was spent on it
  function refundOf(u) { return Math.floor(HEROES[u.type].cost / 2); }
  function recall(s, id) {
    const u = s.units.find(x => x.alive && x.id === id);
    if (!u || u.kind !== 'hero') return 'none';
    if (s.phase !== 'running') return 'over';
    const refund = refundOf(u);
    s.now = s.time;
    u.alive = false; s.gold += refund; s.stats.recalled++;
    emit(s, { type: 'recall', id: u.id, refund });
    return null;
  }

  // the next wave, for the preview shown during a rest: who is coming and through which doors
  function preview(s) {
    const b = battle(s);
    if (s.phase !== 'running' || s.waveActive || s.wave >= b.waves.length - 1) return null;
    const w = b.waves[s.wave + 1], counts = {};
    for (const p of w.parsed) counts[p.type] = (counts[p.type] || 0) + p.count;
    const doors = w.parsed.some(p => p.door == null) ? doorPool(s, w) : [];
    for (const p of w.parsed) if (p.door != null && doors.indexOf(p.door) < 0) doors.push(p.door);
    doors.sort((a, b) => a - b);
    return { index: s.wave + 1, total: b.waves.length, name: w.name, rounds: Math.max(0, s.nextWaveRound - s.round), counts, doors };
  }

  /* Simz plays: a steady build used by the autoplay button and by the balance tests.
     Bards at the back, a Ranger in every row, a Fighter wall, then Wizards, then depth.
     On other maps the same plan is fitted to the squares a hero can stand on. */
  const PLAN = [
    ['bard', 2, 0], ['bard', 1, 0], ['ranger', 2, 1], ['bard', 3, 0],
    ['ranger', 1, 1], ['ranger', 3, 1], ['ranger', 0, 1], ['ranger', 4, 1],
    ['fighter', 2, 4], ['fighter', 1, 4], ['fighter', 3, 4], ['fighter', 0, 4], ['fighter', 4, 4],
    ['wizard', 2, 2], ['bard', 0, 0], ['wizard', 1, 2], ['wizard', 3, 2], ['bard', 4, 0], ['wizard', 0, 2], ['wizard', 4, 2],
    ['cleric', 1, 3], ['cleric', 3, 3],
    ['fighter', 0, 5], ['fighter', 2, 5], ['fighter', 4, 5], ['rogue', 1, 5], ['rogue', 3, 5],
    ['ranger', 2, 3], ['ranger', 0, 3], ['ranger', 4, 3]
  ];
  function derivePlan(map) {
    const ok = (l, q) => l >= 0 && l < map.h && q >= 0 && q < map.w && PLACEABLE.indexOf(map.rows[l][q]) >= 0;
    const taken = new Set(), out = [], later = [];
    PLAN.forEach(([t, l, q], i) => {
      if (l >= map.h) return;
      if (ok(l, q)) { taken.add(l * 100 + q); out[i] = [t, l, q]; } else later.push(i);
    });
    for (const i of later) { // the nearest free square in the same row, toward the tavern first
      const [t, l, q] = PLAN[i];
      for (const dq of [-1, -2, -3, 1, 2, 3, -4, 4, -5, 5]) {
        if (ok(l, q + dq) && !taken.has(l * 100 + q + dq)) { taken.add(l * 100 + q + dq); out[i] = [t, l, q + dq]; break; }
      }
    }
    return out.filter(Boolean);
  }
  function autoplay(s) {
    if (s.phase !== 'running') return 0;
    const map = mapOf(s);
    let placed = 0;
    const put = (type, lane, sq) => { if (!place(s, type, lane, sq)) { placed++; return true; } return false; };
    // a hero in a row only helps against a monster it can see past the pillars
    const shootFrom = (type, lane, sqs, front) => {
      const seen = sqs.filter(q => q < front.sq && clearRow(s, lane, q, front.sq));
      for (const q of seen) if (put(type, lane, q)) return true;
      if (seen.length || sqs.every(q => q >= front.sq)) return false;
      for (let q = 4; q < front.sq; q++) if (clearRow(s, lane, q, front.sq) && put(type, lane, q)) return true;
      return false;
    };
    for (let lane = 0; lane < map.h; lane++) {
      let front = null;
      for (const u of s.units) if (u.alive && u.kind === 'monster' && u.lane === lane && (!front || u.sq < front.sq)) front = u;
      if (!front) continue;
      const mine = s.units.filter(u => u.alive && u.kind === 'hero' && u.lane === lane && u.sq < front.sq);
      const shooters = mine.filter(u => (u.type === 'ranger' || u.type === 'wizard') && clearRow(s, lane, u.sq, front.sq));
      let placedHere = false;
      if (traits(front).resist && !mine.some(u => u.type === 'wizard' && clearRow(s, lane, u.sq, front.sq)))
        placedHere = shootFrom('wizard', lane, [2, 1, 3], front);
      if (!placedHere && !shooters.length) placedHere = shootFrom('ranger', lane, [1, 2, 3], front);
      const wall = mine.some(u => u.type === 'fighter');
      if (!wall && front.sq >= 2 && front.sq <= 6) put('fighter', lane, front.sq - 1);
    }
    let planDone = true;
    for (const [type, lane, sq] of map.plan) {
      const why = canPlace(s, type, lane, sq);
      if (why === 'occupied' || why === 'off') continue;
      if (why) { planDone = false; break; }
      if (HEROES[type].income && monsterAt(s, lane, sq + 1)) continue; // a Bard would only be fed to whatever is next to that square
      put(type, lane, sq);
    }
    // a Barbarian at the worst row: a boss, a crowd, or something close to the tavern
    let best = null, bestScore = 0;
    for (let lane = 0; lane < map.h; lane++) {
      let front = null;
      for (const u of s.units) if (u.alive && u.kind === 'monster' && u.lane === lane && u.sq <= map.w - 2 && (!front || u.sq < front.sq)) front = u;
      if (!front) continue;
      let score = 0, crowd = 0;
      for (const m of s.units) if (m.alive && m.kind === 'monster' && near(m, front)) { score += m.hp; crowd++; }
      if (MONSTERS[front.type].traits.boss) score += 150;
      if (front.sq <= 3) score += 120;
      if (crowd >= 3) score += 60;
      if (score > bestScore) { best = front; bestScore = score; }
    }
    if (best && bestScore >= 60 && (planDone || bestScore >= 150))
      for (let sq = best.sq - 1; sq >= 0; sq--) {
        if (unitAt(s, best.lane, sq) || !placeable(s, best.lane, sq)) continue;
        if (!clearRow(s, best.lane, sq, best.sq)) break;
        put('barbarian', best.lane, sq); break;
      }
    return placed;
  }

  function describe(type) {
    const st = MONSTERS[type];
    if (!st) return HEROES[type] ? HEROES[type].info : '';
    const t = st.traits, a = st.attack, bits = [];
    if (t.boss) bits.push('Boss');
    if (t.undead) bits.push('Undead');
    if (a.range > 1) bits.push((a.kind === 'ranged' ? 'Attacks from ' : 'Reaches ') + a.range + ' squares away');
    if (t.flying) bits.push('Flies over the first hero in its way, and over pits');
    if (st.speed >= 1.5) bits.push('Fast: can move two squares a turn');
    if (t.multi) bits.push('Attacks twice a turn');
    if (t.resist) bits.push('Takes half damage from weapons, full damage from spells');
    if (t.regen) bits.push('Heals ' + t.regen + ' hit points a turn');
    if (t.drain) bits.push('Heals itself with half the damage it deals');
    if (t.paralyse) bits.push('Its hits can paralyse a hero for a turn');
    if (t.split) bits.push('Splits in two when badly hurt');
    if (t.summon) bits.push(t.summon.type === type ? 'Kindles another of its kind' : 'Calls up a ' + MONSTERS[t.summon.type].name.toLowerCase() + ' every third turn');
    if (t.mend) bits.push('Heals the monsters around it');
    if (a.extra) bits.push('Poisonous bite');
    if (!bits.filter(b => b !== 'Boss' && b !== 'Undead').length) bits.push(st.speed <= 0.5 ? 'Slow and heavy' : 'Walks straight at your line');
    return bits.join('. ') + '.';
  }

  // compiled once at load, so a typo in a map or the battle data fails straight away rather than mid-game
  for (const id of Object.keys(MAPS)) MAP_BY_ID[id] = compileMap(id, MAPS[id]);
  for (const b of BATTLES) {
    BATTLE_BY_ID[b.id] = b;
    b.map = b.map || 'classic';
    const map = MAP_BY_ID[b.map];
    if (!map) throw new Error('Hold the Line: battle ' + b.id + ' uses unknown map ' + b.map);
    const types = [];
    for (const w of b.waves) {
      w.parsed = parseSpawns(w.spawns);
      for (const i of (w.doors || [])) if (!map.doors[i]) throw new Error('Hold the Line: battle ' + b.id + ' uses door ' + i + ', which ' + b.map + ' does not have');
      for (const p of w.parsed) {
        if (p.door != null && !map.doors[p.door]) throw new Error('Hold the Line: battle ' + b.id + ' sends a monster through door ' + p.door + ', which ' + b.map + ' does not have');
        if (types.indexOf(p.type) < 0) types.push(p.type);
      }
    }
    b.monsters = types;
    const lv = types.map(t => MONSTERS[t].level);
    b.levels = [Math.min.apply(null, lv), Math.max.apply(null, lv)];
  }

  const PACK = { id: 'core', heroes: HEROES, monsters: MONSTERS, battles: BATTLES, maps: MAP_BY_ID };
  return { ROUND, PACK, HEROES, MONSTERS, BATTLES, MAPS: MAP_BY_ID, STATUSES,
    newGame, step, place, canPlace, recall, refundOf, preview, unitAt, addUnit, slot, battle, mapOf, cellAt, describe, autoplay, parseSpawns,
    addStatus, hasStatus, nearestAhead, heroInReach,
    battleById: id => BATTLE_BY_ID[id] || null,
    _attack: attack, _fireball: fireball };
})();
