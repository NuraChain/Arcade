import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from lib import atlas
from lib import kit
from lib import pieces

kit.reset_scene()
rng = random.Random(11)

BOARD = 0.380
RIM = 0.016
THICK = 0.016
FIELD_DROP = 0.006
FIELD = BOARD - 2 * RIM
CELL = FIELD / 15
FIELD_TOP = THICK - FIELD_DROP

base = kit.box('base', size=(BOARD, BOARD, THICK - FIELD_DROP - 0.002), location=(0, 0, (THICK - FIELD_DROP - 0.002) / 2), bevel_width=0)
kit.paint(base, 'walnut_dark')
rails = []
for sx in (-1, 1):
    rails.append(kit.box('rail', size=(RIM, BOARD, THICK), location=(sx * (BOARD / 2 - RIM / 2), 0, THICK / 2), bevel_width=0))
    rails.append(kit.box('rail', size=(BOARD - 2 * RIM, RIM, THICK), location=(0, sx * (BOARD / 2 - RIM / 2), THICK / 2), bevel_width=0))
for rail in rails:
    kit.paint(rail, 'walnut')
    kit.finish(rail, 0.0022, segments=3, angle=35.0)
kit.finish(base, 0.0015, segments=2, angle=35.0)
board = kit.join([base] + rails, 'Board')
kit.assign(board, 'wood')

field = kit.box('Field', size=(FIELD, FIELD, 0.002), location=(0, 0, FIELD_TOP - 0.001), bevel_width=0)
kit.subdivide(field, 14)
region = atlas.uv_rect('ludo-field', inset=atlas.GUTTER)
kit.uv_planar(field, region, axis='Z', extent=((-FIELD / 2, -FIELD / 2), (FIELD / 2, FIELD / 2)), only_up=False)
kit.paint(field, 'white')
kit.assign(field, 'print')

colours = {'red': 'ludo_red', 'green': 'ludo_green', 'yellow': 'ludo_yellow', 'blue': 'ludo_blue'}
corners = {'red': (0, 0), 'green': (9, 0), 'yellow': (9, 9), 'blue': (0, 9)}
homes = {
    'red': [(c, 7) for c in range(1, 6)],
    'green': [(7, r) for r in range(1, 6)],
    'yellow': [(c, 7) for c in range(9, 14)],
    'blue': [(7, r) for r in range(9, 14)]
}
track_spots = {'red': (2, 6), 'green': (8, 4), 'yellow': (11, 8), 'blue': (6, 10)}


def cell_centre(col, row):
    return ((col + 0.5) * CELL - FIELD / 2, FIELD / 2 - (row + 0.5) * CELL)


tokens = {name: [] for name in colours}
for name, (c0, r0) in corners.items():
    bx, by = cell_centre(c0 + 2.5, r0 + 2.5)
    spots = [(bx - CELL * 0.95, by - CELL * 0.95), (bx + CELL * 0.95, by + CELL * 0.95)]
    for x, y in spots:
        pawn = pieces.pawn('pawn', colours[name])
        pawn.location = (x + rng.uniform(-0.001, 0.001), y + rng.uniform(-0.001, 0.001), FIELD_TOP)
        pawn.rotation_euler = (0, 0, rng.uniform(0, math.tau))
        tokens[name].append(pawn)
    tx, ty = cell_centre(*track_spots[name])
    pawn = pieces.pawn('pawn', colours[name])
    pawn.location = (tx, ty, FIELD_TOP)
    pawn.rotation_euler = (0, 0, rng.uniform(0, math.tau))
    tokens[name].append(pawn)
    hx, hy = cell_centre(*homes[name][2])
    pawn = pieces.pawn('pawn', colours[name])
    pawn.location = (hx, hy, FIELD_TOP)
    pawn.rotation_euler = (0, 0, rng.uniform(0, math.tau))
    tokens[name].append(pawn)

token_meshes = []
for name, group in tokens.items():
    mesh = kit.join(group, 'Tokens_' + name.capitalize())
    kit.assign(mesh, 'lacquer')
    token_meshes.append(mesh)

dice = []
for index, (x, y, yaw, rot_x) in enumerate(((0.10, -0.045, 0.7, math.pi), (0.135, -0.07, 2.1, -math.pi / 2))):
    die = pieces.die('Die', size=0.016, seed=index)
    die.location = (x, y, FIELD_TOP + 0.008)
    die.rotation_euler = (rot_x, 0, yaw)
    dice.append(die)
dice = kit.join(dice, 'Dice')
kit.assign(dice, 'lacquer')

proxy = kit.box('proxy', size=(1.2, 1.2, 0.02), location=(0, 0, -0.01), bevel_width=0)
kit.paint(proxy, 'white')

parts = [board, field] + token_meshes + [dice]
kit.bake_ao(parts, distance=0.05, samples=48, strength=0.85)
bpy.data.objects.remove(proxy, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'set-ludo-dolly.png'), look_at=(0, 0, 0.01), distance=2.3, height=1.65, fov=34)
kit.render_preview(os.path.join(out, 'set-ludo-close.png'), look_at=(0.02, -0.02, 0.01), distance=0.5, height=0.38, fov=40, yaw=0.55)

root = kit.parent(parts, 'LudoSet')
kit.export(kit.output_path('set-ludo'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
