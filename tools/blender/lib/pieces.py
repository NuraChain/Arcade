import json
import math
import os
import random

import bpy
from mathutils import Matrix, Vector

from lib import kit
from lib import looks

CARD = (0.0635, 0.0889)
CARD_THICKNESS = 0.00045
CARD_RADIUS = 0.0034

CHIP_RADIUS = 0.0195
CHIP_THICKNESS = 0.0033

DIE_PIPS = {
    1: [(0, 0)],
    2: [(-1, -1), (1, 1)],
    3: [(-1, -1), (0, 0), (1, 1)],
    4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
    5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
    6: [(-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 0), (1, 1)]
}

DIE_FACES = {
    (0, 0, 1): 1,
    (0, 0, -1): 6,
    (-1, 0, 0): 2,
    (1, 0, 0): 5,
    (0, -1, 0): 3,
    (0, 1, 0): 4
}

WHITE_UV = (0.5, 0.03)

_atlases = {}


def _rects(name):
    if name not in _atlases:
        with open(os.path.join(kit.ART, name + '.json'), encoding='utf-8') as handle:
            _atlases[name] = json.load(handle)
    return _atlases[name]


def _uv_rect(width, height, rect):
    return (
        rect['x'] / width,
        1.0 - (rect['y'] + rect['height']) / height,
        (rect['x'] + rect['width']) / width,
        1.0 - rect['y'] / height
    )


def card_rect(code):
    data = _rects('cards')
    cell = next(cell for cell in data['cells'] if cell['code'] == code)
    return _uv_rect(data['width'], data['height'], cell)


def _lerp_rect(rect, u, v):
    return (rect[0] + (rect[2] - rect[0]) * u, rect[1] + (rect[3] - rect[1]) * v)


def card(name, code, face_up=True):
    width, height = CARD
    obj = kit.rounded_plate(name, width, height, CARD_THICKNESS, CARD_RADIUS, corner_segments=5)
    obj.location = (0.0, 0.0, 0.0)
    face = card_rect(code)
    back = card_rect('back')
    top, bottom = (face, back) if face_up else (back, face)

    def mapper(poly, co):
        u = (co.x + width / 2) / width
        v = (co.y + height / 2) / height
        if poly.normal.z > 0.5:
            return _lerp_rect(top, u, v)
        if poly.normal.z < -0.5:
            return _lerp_rect(bottom, 1.0 - u, v)
        return WHITE_UV

    kit.uv_map(obj, mapper)
    kit.assign(obj, looks.card())
    return obj


def chip(name, colour):
    data = _rects('chips')
    cell = next(cell for cell in data['cells'] if cell['name'] == colour)
    face = _uv_rect(data['width'], data['height'], cell['face'])
    edge = _uv_rect(data['width'], data['height'], cell['edge'])
    r = CHIP_RADIUS
    t = CHIP_THICKNESS
    profile = [
        (0.0, 0.0),
        (r - 0.0012, 0.0),
        (r - 0.0003, 0.0003),
        (r, 0.0009),
        (r, t - 0.0009),
        (r - 0.0003, t - 0.0003),
        (r - 0.0012, t),
        (0.0, t)
    ]
    obj = kit.lathe(name, profile, sides=40)

    def mapper(poly, co):
        if abs(poly.normal.z) > 0.6:
            return _lerp_rect(face, 0.5 + co.x / (2 * r), 0.5 + co.y / (2 * r))
        centre = poly.calc_center_median()
        centre_angle = math.atan2(centre.y, centre.x)
        angle = math.atan2(co.y, co.x)
        while angle - centre_angle > math.pi:
            angle -= math.tau
        while angle - centre_angle < -math.pi:
            angle += math.tau
        u = angle / math.tau + 1.0 / 16.0
        v = min(max(co.z / t, 0.0), 1.0)
        return (edge[0] + (edge[2] - edge[0]) * u, edge[1] + (edge[3] - edge[1]) * v)

    kit.uv_map(obj, mapper)
    kit.assign(obj, looks.chip())
    kit.smooth(obj, 35.0)
    return obj


def stack(prototype, count, x, y, z, seed=0, parent=None):
    rng = random.Random(seed)
    placed = []
    for index in range(count):
        copy = prototype.copy()
        copy.name = '%s-%d-%d' % (prototype.name, seed, index)
        bpy.context.collection.objects.link(copy)
        copy.location = (x + rng.uniform(-0.0004, 0.0004), y + rng.uniform(-0.0004, 0.0004), z + index * CHIP_THICKNESS)
        copy.rotation_euler = (0.0, 0.0, rng.uniform(0.0, math.tau))
        if parent is not None:
            copy.parent = parent
        placed.append(copy)
    return placed


def checker(name, side, diameter=0.034, thickness=0.0085):
    r = diameter / 2
    t = thickness
    profile = [
        (0.0, 0.0004),
        (r - 0.0030, 0.0),
        (r - 0.0009, 0.0008),
        (r, 0.0022),
        (r, t - 0.0022),
        (r - 0.0009, t - 0.0008),
        (r - 0.0030, t),
        (r * 0.62, t),
        (r * 0.56, t - 0.0006),
        (r * 0.50, t - 0.0006),
        (r * 0.46, t),
        (0.0, t)
    ]
    obj = kit.lathe(name, profile, sides=40)
    kit.assign(obj, looks.checker(side), looks.checker_rim(side))
    kit.slot(obj, 1, lambda centre, normal: math.hypot(centre.x, centre.y) > r - 0.0024 or (r * 0.45 < math.hypot(centre.x, centre.y) < r * 0.63 and centre.z > t - 0.0008))
    kit.smooth(obj, 40.0)
    return obj


def pawn(name, colour):
    profile = [
        (0.0, 0.0),
        (0.0112, 0.0),
        (0.0118, 0.0011),
        (0.0117, 0.0036),
        (0.0106, 0.0048),
        (0.0092, 0.0054),
        (0.0088, 0.0068),
        (0.0079, 0.0115),
        (0.0066, 0.0165),
        (0.0056, 0.0198),
        (0.0060, 0.0208),
        (0.0072, 0.0218),
        (0.0060, 0.0229)
    ]
    ball_r = 0.0082
    ball_z = 0.0292
    for step in range(1, 12):
        a = -math.pi / 2 + math.pi * step / 12
        profile.append((max(math.cos(a) * ball_r, 0.0), ball_z + math.sin(a) * ball_r))
    profile.append((0.0, ball_z + ball_r))
    obj = kit.lathe(name, profile, sides=36)
    kit.assign(obj, looks.pawn(colour))
    kit.smooth(obj, 45.0)
    return obj


def die(name, size, body, pip):
    obj = kit.box(name, size=(size, size, size), bevel_width=0)
    kit.finish(obj, size * 0.14, segments=4, angle=35.0)
    pips = []
    pip_r = size * 0.1
    depth = size * 0.045
    spread = size * 0.25
    for normal, value in DIE_FACES.items():
        n = Vector(normal)
        axis_a = Vector((0, 1, 0)) if abs(n.y) < 0.5 else Vector((1, 0, 0))
        axis_b = n.cross(axis_a).normalized()
        axis_a = axis_b.cross(n).normalized()
        for px, py in DIE_PIPS[value]:
            centre = n * (size / 2 + pip_r - depth) + axis_a * (px * spread) + axis_b * (py * spread)
            pips.append(kit.sphere('pip', radius=pip_r, segments=16, rings=8, location=tuple(centre)))
    cutter = kit.join(pips, name + '-pips')
    modifier = obj.modifiers.new('Pips', 'BOOLEAN')
    modifier.operation = 'DIFFERENCE'
    modifier.object = cutter
    modifier.solver = 'EXACT'
    kit.apply_modifiers(obj)
    bpy.data.objects.remove(cutter, do_unlink=True)
    limit = size / 2 - depth * 0.35
    kit.assign(obj, body, pip)
    kit.slot(obj, 1, lambda centre, normal: max(abs(centre.x), abs(centre.y), abs(centre.z)) < limit)
    kit.smooth(obj, 35.0)
    return obj


def _glyph(name, text, size):
    curve = bpy.data.curves.new(name, type='FONT')
    curve.body = text
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.extrude = size * 0.02
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    kit.select_only(obj)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.active_object


def _on_face(glyph, normal, distance, up):
    n = Vector(normal)
    z = n
    y = Vector(up)
    x = y.cross(z).normalized()
    y = z.cross(x).normalized()
    matrix = [[x.x, y.x, z.x], [x.y, y.y, z.y], [x.z, y.z, z.z]]
    rotation = Matrix(matrix).to_4x4()
    glyph.data.transform(rotation)
    glyph.data.transform(Matrix.Translation(n * distance))
    glyph.data.update()


def doubling_cube(name, size, showing):
    obj = kit.box(name, size=(size, size, size), bevel_width=0)
    kit.finish(obj, size * 0.1, segments=3, angle=35.0)
    others = [value for value in (2, 4, 8, 16, 32, 64) if value != showing]
    faces = [((0, 0, 1), showing, (0, 1, 0))] + list(zip(
        [(0, 0, -1), (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)],
        others,
        [(0, 1, 0), (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)]
    ))
    glyphs = []
    for normal, value, up in faces:
        glyph = _glyph(name + '-%d' % value, str(value), size * (0.52 if value < 10 else 0.42))
        _on_face(glyph, normal, size / 2 + 0.00005, up)
        glyphs.append(glyph)
    numbers = kit.join(glyphs, name + '-numbers')
    kit.assign(obj, looks.ivory())
    kit.assign(numbers, looks.ink())
    return [obj, numbers]


def dealer_button(name, diameter=0.046, thickness=0.007):
    r = diameter / 2
    profile = [(0.0, 0.0), (r - 0.0015, 0.0), (r, 0.0015), (r, thickness - 0.0015), (r - 0.0015, thickness), (0.0, thickness)]
    obj = kit.lathe(name, profile, sides=48)
    kit.assign(obj, looks.ivory())
    kit.smooth(obj, 40.0)
    letter = _glyph(name + '-letter', 'D', diameter * 0.5)
    _on_face(letter, (0, 0, 1), thickness + 0.00005, (0, 1, 0))
    kit.assign(letter, looks.ink())
    return [obj, letter]


def place(obj, x, y, z=0.0, yaw=0.0, pitch=0.0, roll=0.0):
    obj.location = (x, y, z)
    obj.rotation_euler = (roll, pitch, yaw)
    return obj


def fan(cards, cx, cy, z, facing, spread=8.0, pivot=0.09, bow=0.0):
    count = len(cards)
    for index, obj in enumerate(cards):
        offset = index - (count - 1) / 2
        angle = facing + math.radians(spread) * offset
        x = cx - math.cos(facing) * pivot + math.cos(angle) * pivot
        y = cy - math.sin(facing) * pivot + math.sin(angle) * pivot
        lift = bow * (1.0 - (2.0 * index / max(count - 1, 1) - 1.0) ** 2)
        obj.location = (x, y, z + index * CARD_THICKNESS * 1.1 + lift)
        obj.rotation_euler = (0.0, 0.0, angle - math.pi / 2)
    return cards
