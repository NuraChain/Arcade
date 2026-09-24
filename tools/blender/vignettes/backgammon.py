import math

import bmesh
import bpy

from lib import kit
from lib import looks
from lib import pieces
from lib import settle
from lib import studio

TOP = studio.PLINTH_HEIGHT
WIDTH = 0.46
DEPTH = 0.36
HEIGHT = 0.03
RECESS = 0.004
FIELD_TOP = TOP + HEIGHT - RECESS
BAR = 0.016
HALF = 0.198
COLUMN = HALF / 6
POINT_LENGTH = 0.138
EDGE = 0.162
CHECKER = 0.0305

LIGHT = {24: 2, 13: 5, 8: 3, 6: 5}
DARK = {1: 2, 12: 5, 17: 3, 19: 5}


def column_x(point):
    if 1 <= point <= 6:
        return BAR + (6 - point + 0.5) * COLUMN
    if 7 <= point <= 12:
        return -(BAR + (point - 7 + 0.5) * COLUMN)
    if 13 <= point <= 18:
        return -(BAR + (18 - point + 0.5) * COLUMN)
    return BAR + (point - 19 + 0.5) * COLUMN


def bottom(point):
    return point <= 12


def triangle(name, point, material):
    x = column_x(point)
    sign = 1.0 if bottom(point) else -1.0
    base_y = -EDGE * sign
    tip_y = base_y + POINT_LENGTH * sign
    half = COLUMN * 0.46
    bm = bmesh.new()
    z0 = FIELD_TOP
    z1 = FIELD_TOP + 0.0004
    corners = [(x - half, base_y), (x + half, base_y), (x, tip_y)]
    low = [bm.verts.new((cx, cy, z0)) for cx, cy in corners]
    high = [bm.verts.new((cx, cy, z1)) for cx, cy in corners]
    bm.faces.new(high)
    for index in range(3):
        nxt = (index + 1) % 3
        bm.faces.new((low[index], low[nxt], high[nxt], high[index]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = kit.mesh_object(name, bm)
    kit.assign(obj, material)
    return obj


def build():
    root = bpy.data.objects.new('backgammon', None)
    bpy.context.collection.objects.link(root)

    plinth = studio.plinth('backgammon-plinth')

    board = kit.rounded_plate('backgammon-board', WIDTH, DEPTH, HEIGHT - RECESS, 0.018, corner_segments=8, location=(0.0, 0.0, TOP))
    kit.uv_box(board, scale=1.6)
    kit.assign(board, looks.walnut())
    kit.smooth(board, 30.0)

    frame_path = kit.rect_path(WIDTH / 2 - 0.009, DEPTH / 2 - 0.009, 0.012, corner_segments=6)
    lip = kit.sweep('backgammon-lip', [(-0.009, FIELD_TOP), (-0.009, FIELD_TOP + RECESS), (0.009, FIELD_TOP + RECESS), (0.009, FIELD_TOP)], frame_path)
    kit.uv_box(lip, scale=1.6)
    kit.assign(lip, looks.walnut())

    bar = kit.box('backgammon-bar', size=(BAR * 2, DEPTH - 0.018, RECESS), location=(0.0, 0.0, FIELD_TOP + RECESS / 2), bevel_width=0.0008)
    kit.uv_box(bar, scale=1.6)
    kit.assign(bar, looks.walnut())

    fields = []
    for side in (-1, 1):
        field = kit.box('backgammon-field-%s' % ('left' if side < 0 else 'right'), size=(HALF, EDGE * 2, 0.002), location=(side * (BAR + HALF / 2), 0.0, FIELD_TOP - 0.0008), bevel_width=0)
        kit.assign(field, looks.nard_field())
        fields.append(field)

    inlays = []
    for side in (-1, 1):
        cx = side * (BAR + HALF / 2)
        path = [(cx + x, y) for x, y in kit.rect_path(HALF / 2 - 0.004, EDGE - 0.004, 0.002, corner_segments=2)]
        inlay = kit.sweep('backgammon-inlay-%d' % side, [(-0.0008, FIELD_TOP), (-0.0008, FIELD_TOP + 0.0004), (0.0008, FIELD_TOP + 0.0004), (0.0008, FIELD_TOP)], path)
        kit.assign(inlay, looks.nard('inlay'))
        inlays.append(inlay)

    points = [triangle('backgammon-point-%d' % point, point, looks.nard('point-a') if point % 2 == 0 else looks.nard('point-b')) for point in range(1, 25)]

    holder = bpy.data.objects.new('backgammon-checkers', None)
    bpy.context.collection.objects.link(holder)
    holder.parent = root
    placed = []
    for side, layout in (('light', LIGHT), ('dark', DARK)):
        prototype = pieces.checker('backgammon-checker-' + side, side, diameter=CHECKER, thickness=0.0078)
        for point, count in layout.items():
            x = column_x(point)
            sign = 1.0 if bottom(point) else -1.0
            for index in range(count):
                copy = prototype.copy()
                copy.name = 'backgammon-%s-%d-%d' % (side, point, index)
                bpy.context.collection.objects.link(copy)
                copy.location = (x, -sign * (EDGE - CHECKER / 2 - 0.001 - index * (CHECKER + 0.0004)), FIELD_TOP + 0.0005)
                copy.rotation_euler = (0.0, 0.0, (point * 7 + index * 13) % 360 * math.pi / 180)
                copy.parent = holder
                placed.append(copy)
        bpy.data.objects.remove(prototype, do_unlink=True)

    dice = []
    for index, (x, y, yaw, roll) in enumerate([(0.1, 0.004, 17.0, 0.0), (0.135, -0.024, -24.0, math.pi / 2)]):
        die = pieces.die('backgammon-die-%d' % index, 0.017, looks.ivory(), looks.ink())
        pieces.place(die, x, y, FIELD_TOP + 0.0085, math.radians(yaw), 0.0, roll)
        dice.append(die)
    settle.drop(dice[0], 'settle-backgammon-a', 0.2, (3.8, 1.5, 2.2), bounce=0.006, drift=(-0.03, 0.02))
    settle.drop(dice[1], 'settle-backgammon-b', 0.22, (-3.2, 2.4, -1.8), start=4, bounce=0.006, drift=(-0.02, -0.01))

    cube = pieces.doubling_cube('backgammon-cube', 0.024, 64)
    for part in cube:
        pieces.place(part, 0.0, 0.0, FIELD_TOP + RECESS + 0.012, math.radians(8.0))

    for obj in [plinth, board, lip, bar] + fields + inlays + points + dice + cube:
        obj.parent = root

    return {
        'root': root,
        'plinth': plinth,
        'surfaces': [board] + fields,
        'raised': [lip, bar] + inlays,
        'pieces': points + placed + dice + cube,
        'surface_z': FIELD_TOP + 0.0004,
        'surface_size': 0.44,
        'surface_clip': (WIDTH, DEPTH),
        'hero': {'look_at': (0.0, 0.0, 0.15), 'position': (-0.3, -0.62, 0.5), 'fov': 30.0}
    }
