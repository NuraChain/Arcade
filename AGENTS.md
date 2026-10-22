# Baziche — notes for coding agents

The full working notes are in `CLAUDE.md` (and the `CLAUDE.md` files and `.claude/rules/` it points
to). Read them first; this file holds the rules every agent must follow whatever tool it runs in.

## Comments

**Comment only when the code cannot say it.** A comment earns its place when it records something a
reader could not work out from the code itself: why a non-obvious choice was made, a constraint from
outside the code (a browser quirk, a protocol rule, a framework defect), or a trap the next person
would otherwise fall into.

Do not write a comment that:

- restates what the code does (`// increment the count`, `// return the user`);
- narrates the change you just made, or says what the code used to be;
- labels a section, repeats a name, or describes an obvious type;
- explains something already written in the notes or the tests.

When a comment feels needed to explain *what* the code does, rename or restructure instead. When
in doubt, leave it out.
