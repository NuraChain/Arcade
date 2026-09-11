import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy
import bmesh

from lib import kit
from lib import pieces

kit.reset_scene()
rng = random.Random(24)

D = 0.034
POINT_BASE = 0.035
POINT_LENGTH = 0.170
FRAME = 0.018
BAR_HALF = 0.022
HALF_W = FRAME + 6 * POINT_BASE + BAR_HALF
DEPTH = 2 * FRAME + 2 * POINT_LENGTH + 0.044
BASE_Z = 0.017
RIM = 0.009
FIELD_Z = BASE_Z
BAR_HEIGHT = 0.011

frame_parts = []
field_parts = []


def half(sign):
    cx = sign * HALF_W / 2
    slab = kit.box('slab', size=(HALF_W - 0.0005, DEPTH, BASE_Z), location=(cx, 0, BASE_Z / 2), bevel_width=0)
    kit.paint(slab, 'walnut')
    outer_x = sign * (HALF_W - FRAME / 2)
    inner_x = sign * (BAR_HALF / 2)
    rails = [
        kit.box('rail', size=(FRAME, DEPTH, RIM), location=(outer_x, 0, BASE_Z + RIM / 2), bevel_width=0),
        kit.box('rail', size=(HALF_W - FRAME - BAR_HALF, FRAME, RIM), location=(sign * (BAR_HALF + (HALF_W - FRAME - BAR_HALF) / 2), DEPTH / 2 - FRAME / 2, BASE_Z + RIM / 2), bevel_width=0),
        kit.box('rail', size=(HALF_W - FRAME - BAR_HALF, FRAME, RIM), location=(sign * (BAR_HALF + (HALF_W - FRAME - BAR_HALF) / 2), -(DEPTH / 2 - FRAME / 2), BASE_Z + RIM / 2), bevel_width=0),
        kit.box('bar', size=(BAR_HALF - 0.0005, DEPTH, BAR_HEIGHT), location=(inner_x, 0, BASE_Z + BAR_HEIGHT / 2), bevel_width=0)
    ]
    for rail in rails:
        kit.paint(rail, 'walnut' if rail.name.startswith('rail') else 'walnut_dark')
    frame_parts.extend([slab] + rails)

    field_w = HALF_W - FRAME - BAR_HALF
    field = kit.box('field', size=(field_w, DEPTH - 2 * FRAME, 0.0015), location=(sign * (BAR_HALF + field_w / 2), 0, FIELD_Z + 0.00075), bevel_width=0)
    kit.subdivide(field, 14)
    kit.paint(field, 'leather')
    field_parts.append(field)


half(1)
half(-1)

for part in frame_parts:
    kit.finish(part, 0.0022, segments=3, angle=35.0)

frame = kit.join(frame_parts, 'Frame')
kit.assign(frame, 'wood')
field = kit.join(field_parts, 'Field')
kit.assign(field, 'leather')


def point_x(number):
    if number <= 6:
        return BAR_HALF + (6.5 - number) * POINT_BASE
    if number <= 12:
        return -(BAR_HALF + (number - 6.5) * POINT_BASE)
    if number <= 18:
        return -(BAR_HALF + (18.5 - number) * POINT_BASE)
    return BAR_HALF + (number - 18.5) * POINT_BASE


def point_triangle(number):
    x = point_x(number)
    top = number > 12
    edge_y = (DEPTH / 2 - FRAME) * (1 if top else -1)
    tip_y = edge_y - (POINT_LENGTH if top else -POINT_LENGTH)
    half_base = POINT_BASE / 2 - 0.0008
    bm = bmesh.new()
    a = bm.verts.new((x - half_base, edge_y, 0.0))
    b = bm.verts.new((x + half_base, edge_y, 0.0))
    c = bm.verts.new((x, tip_y, 0.0))
    face = bm.faces.new((a, b, c))
    result = bmesh.ops.extrude_face_region(bm, geom=[face])
    verts = [element for element in result['geom'] if isinstance(element, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=verts, vec=(0.0, 0.0, 0.0006))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = kit.mesh_object('point', bm, location=(0, 0, FIELD_Z + 0.0015))
    kit.paint(obj, '#C9A97A' if number % 2 == 0 else 'oxblood')
    return obj


points = kit.join([point_triangle(number) for number in range(1, 25)], 'Points')
kit.assign(points, 'leather')

hinges = []
for y in (-0.11, 0.11):
    plate = kit.box('hinge', size=(0.046, 0.014, 0.0018), location=(0, y, BASE_Z + BAR_HEIGHT + 0.0009), bevel_width=0)
    kit.paint(plate, 'brass')
    kit.finish(plate, 0.0006, segments=2, angle=35.0)
    pin = kit.cylinder('pin', radius=0.0028, depth=0.052, sides=16, location=(0, y, BASE_Z + BAR_HEIGHT + 0.0028), rotation=(0, math.pi / 2, 0), bevel_width=0)
    kit.paint(pin, 'brass_dark')
    kit.smooth(pin, 40.0)
    hinges.extend([plate, pin])
for sx in (-1, 1):
    for sy in (-1, 1):
        cap = kit.box('cap', size=(0.016, 0.016, BASE_Z + RIM + 0.0008), location=(sx * (HALF_W - 0.008), sy * (DEPTH / 2 - 0.008), (BASE_Z + RIM + 0.0008) / 2), bevel_width=0)
        kit.paint(cap, 'brass')
        kit.finish(cap, 0.001, segments=2, angle=35.0)
        hinges.append(cap)
hinges = kit.join(hinges, 'Hinges')
kit.assign(hinges, 'brass')

CHECKER_Z = FIELD_Z + 0.0015 + 0.0006


def stack(number, count, colour_name, into):
    x = point_x(number)
    top = number > 12
    start_y = (DEPTH / 2 - FRAME - D / 2) * (1 if top else -1)
    step = -D if top else D
    for index in range(count):
        checker = pieces.checker('checker', colour_name, diameter=D, thickness=0.009, sides=22)
        checker.location = (
            x + rng.uniform(-0.0006, 0.0006),
            start_y + step * index * 0.985 + rng.uniform(-0.0004, 0.0004),
            CHECKER_Z
        )
        checker.rotation_euler = (0, 0, rng.uniform(0, math.tau))
        into.append(checker)


bone = []
ebony = []
stack(24, 2, 'bone', bone)
stack(13, 5, 'bone', bone)
stack(8, 3, 'bone', bone)
stack(6, 5, 'bone', bone)
stack(1, 2, 'ebony', ebony)
stack(12, 5, 'ebony', ebony)
stack(17, 3, 'ebony', ebony)
stack(19, 5, 'ebony', ebony)
checkers_bone = kit.join(bone, 'Checkers_Bone')
kit.assign(checkers_bone, 'lacquer')
checkers_ebony = kit.join(ebony, 'Checkers_Ebony')
kit.assign(checkers_ebony, 'lacquer')

cube = pieces.doubling_cube('DoublingCube', size=0.032, showing=64)
cube.location = (0, -0.075, BASE_Z + BAR_HEIGHT + 0.016)
cube.rotation_euler = (0, 0, math.radians(8))

dice = []
for index, (x, y, yaw, rotate_x) in enumerate(((0.118, -0.052, 0.6, math.pi), (0.158, -0.028, 2.3, -math.pi / 2))):
    die = pieces.die('Die', size=0.014, seed=index)
    die.location = (x, y, FIELD_Z + 0.0015 + 0.007)
    die.rotation_euler = (rotate_x, 0, yaw)
    dice.append(die)
dice = kit.join(dice, 'Dice')
kit.assign(dice, 'lacquer')

cup = pieces.dice_cup('DiceCup')
cup.location = (0.196, 0.165, BASE_Z + RIM)
cup.rotation_euler = (0, 0, 0.4)

proxy = kit.box('proxy', size=(1.4, 1.4, 0.02), location=(0, 0, -0.01), bevel_width=0)
kit.paint(proxy, 'white')

parts = [frame, field, points, hinges, checkers_bone, checkers_ebony, cube, dice, cup]
kit.bake_ao(parts, distance=0.06, samples=48, strength=0.85)
bpy.data.objects.remove(proxy, do_unlink=True)

kit.render_preview(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out', 'set-backgammon-dolly.png'), look_at=(0, 0, 0.02), distance=2.3, height=1.65, fov=34)
kit.render_preview(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out', 'set-backgammon-close.png'), look_at=(0.05, -0.05, 0.02), distance=0.55, height=0.42, fov=40, yaw=0.6)

root = kit.parent(parts, 'BackgammonSet')
root.rotation_euler = (0, 0, math.pi / 2)
kit.export(kit.output_path('set-backgammon'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
