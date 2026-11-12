# Saved campaigns, as players have them

One example of each shape the campaign save has had. The tests load every file here with the game's own loader and
check the result against `expect`, so an old save that stops loading fails the gate.

When the save changes shape (campaign.js: raise `VERSION`, add a step to `STEPS`), copy a save of the old shape here
first, with what it should load as.

- `save`: what was in the browser's storage, under `mitzsimz.holdTheLine.campaign`
  (or, for `v0`, the list of won battles under `mitzsimz.holdTheLine.won`).
- `expect`: a few things that must come through: won battles with their stars, takings, upgrade levels, trophies.
