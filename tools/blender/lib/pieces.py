import math
import random

import bmesh
import bpy
from mathutils import Vector

from lib import atlas
from lib import kit

CARD_SIZES = {
    'poker': (0.0635, 0.0889),
    'bridge': (0.05715, 0.0889)
}
CARD_THICKNESS = 0.0006
CARD_RADIUS = 0.0032

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


def _swatch(name):
    return atlas.uv_point('swatch-' + name, 0.5, 0.5)


def card(name, code, size='poker', face_up=True):
    width, height = CARD_SIZES[size]
    obj = kit.rounded_plate(name, width, height, CARD_THICKNESS, CARD_RADIUS, corner_segments=4)
    face_rect = atlas.uv_rect('card-' + code) if code != 'back' else atlas.uv_rect('card-back')
    back_rect = atlas.uv_rect('card-back')
    top_rect, bottom_rect = (face_rect, back_rect) if face_up else (back_rect, face_rect)
    edge = _swatch('white')

    def mapper(face, co):
        nz = face.normal.z
        if nz > 0.5:
            rect = top_rect
            u = (co.x + width / 2) / width
        elif nz < -0.5:
            rect = bottom_rect
            u = 1.0 - (co.x + width / 2) / width
        else:
            return edge
        v = (co.y + height / 2) / height
        return (rect[0] + (rect[2] - rect[0]) * u, rect[1] + (rect[3] - rect[1]) * v)

    kit.uv_map(obj, mapper)
    kit.paint(obj, 'white')
    kit.assign(obj, 'print')
    return obj


def deck(name, count=40, size='poker', top='back'):
    width, height = CARD_SIZES[size]
    depth = CARD_THICKNESS * count
    obj = kit.rounded_plate(name, width, height, depth, CARD_RADIUS, corner_segments=4)
    top_rect = atlas.uv_rect('card-back') if top == 'back' else atlas.uv_rect('card-' + top)
    edge_rect = atlas.uv_rect('deckedge')

    def mapper(face, co):
        nz = face.normal.z
        if nz > 0.5:
            u = (co.x + width / 2) / width
            v = (co.y + height / 2) / height
            return (top_rect[0] + (top_rect[2] - top_rect[0]) * u, top_rect[1] + (top_rect[3] - top_rect[1]) * v)
        if nz < -0.5:
            return _swatch('white')
        along = (co.x + co.y + width) / (width + height)
        v = co.z / depth
        return (edge_rect[0] + (edge_rect[2] - edge_rect[0]) * (along % 1.0), edge_rect[1] + (edge_rect[3] - edge_rect[1]) * v)

    kit.uv_map(obj, mapper)
    kit.paint(obj, 'white')
    kit.assign(obj, 'print')
    return obj


def chip_stack(name, value, count, seed=0, sides=20):
    rng = random.Random(seed * 7919 + count)
    profile = [(0.0, 0.0), (CHIP_RADIUS - 0.0022, 0.0)]
    groove = 0.0005
    for index in range(count):
        z0 = index * CHIP_THICKNESS
        profile.append((CHIP_RADIUS - groove, z0 + 0.0003))
        profile.append((CHIP_RADIUS, z0 + 0.0011))
    top = count * CHIP_THICKNESS
    profile += [(CHIP_RADIUS - 0.0022, top), (0.0, top)]
    obj = kit.lathe(name, profile, sides=sides)
    face_rect = atlas.uv_rect('chip-' + value)
    edge_rect = atlas.uv_rect('chipedge-' + value)
    offsets = [rng.random() for _ in range(count)]

    def mapper(face, co):
        nz = face.normal.z
        if abs(nz) > 0.6:
            u = 0.5 + co.x / (2 * CHIP_RADIUS)
            v = 0.5 + co.y / (2 * CHIP_RADIUS)
            return (face_rect[0] + (face_rect[2] - face_rect[0]) * u, face_rect[1] + (face_rect[3] - face_rect[1]) * v)
        centre = face.calc_center_median()
        centre_angle = math.atan2(centre.y, centre.x)
        angle = math.atan2(co.y, co.x)
        while angle - centre_angle > math.pi:
            angle -= math.tau
        while angle - centre_angle < -math.pi:
            angle += math.tau
        index = min(int(centre.z / CHIP_THICKNESS), count - 1)
        u = (angle / math.tau + offsets[index]) % 1.0
        v = (co.z - index * CHIP_THICKNESS) / CHIP_THICKNESS
        v = min(max(v, 0.0), 1.0)
        return (edge_rect[0] + (edge_rect[2] - edge_rect[0]) * u, edge_rect[1] + (edge_rect[3] - edge_rect[1]) * v)

    kit.uv_map(obj, mapper)
    kit.paint(obj, 'white')
    kit.assign(obj, 'print')
    kit.smooth(obj, 35.0)
    return obj


def checker(name, colour_name, diameter=0.034, thickness=0.009, sides=28):
    r = diameter / 2
    t = thickness
    profile = [
        (0.0, 0.0005),
        (r - 0.0032, 0.0),
        (r - 0.0010, 0.0009),
        (r, 0.0024),
        (r, t - 0.0024),
        (r - 0.0010, t - 0.0009),
        (r - 0.0032, t),
        (r * 0.50, t),
        (r * 0.42, t - 0.0007),
        (r * 0.20, t - 0.0011),
        (0.0, t - 0.0012)
    ]
    obj = kit.lathe(name, profile, sides=sides)
    kit.paint(obj, colour_name)
    kit.assign(obj, 'lacquer')
    kit.smooth(obj, 40.0)
    return obj


def pawn(name, colour_name):
    profile = [
        (0.0, 0.0),
        (0.0080, 0.0),
        (0.0092, 0.0012),
        (0.0092, 0.0030),
        (0.0072, 0.0042),
        (0.0052, 0.0080),
        (0.0040, 0.0140),
        (0.0044, 0.0172),
        (0.0060, 0.0186),
        (0.0044, 0.0200)
    ]
    ball_r = 0.0056
    ball_z = 0.0214
    for step in range(1, 8):
        a = -math.pi / 2 + math.pi * step / 8
        profile.append((math.cos(a) * ball_r, ball_z + math.sin(a) * ball_r))
    profile.append((0.0, ball_z + ball_r))
    obj = kit.lathe(name, profile, sides=20)
    kit.paint(obj, colour_name)
    kit.assign(obj, 'lacquer')
    kit.smooth(obj, 40.0)
    return obj


def die(name, size=0.016, body='bone', pip='ebony', seed=0):
    obj = kit.box(name, size=(size, size, size), bevel_width=0)
    kit.finish(obj, size * 0.11, segments=3, angle=35.0)

    pips = []
    pip_r = size * 0.115
    depth = size * 0.045
    spread = size * 0.24
    for normal, value in DIE_FACES.items():
        n = Vector(normal)
        axis_a = Vector((0, 1, 0)) if abs(n.y) < 0.5 else Vector((1, 0, 0))
        axis_b = n.cross(axis_a).normalized()
        axis_a = axis_b.cross(n).normalized()
        for px, py in DIE_PIPS[value]:
            centre = n * (size / 2 + pip_r - depth) + axis_a * (px * spread) + axis_b * (py * spread)
            pips.append(kit.sphere('pip', radius=pip_r, segments=12, rings=6, location=tuple(centre)))
    cutter = kit.join(pips, name + '-pips')
    modifier = obj.modifiers.new('Pips', 'BOOLEAN')
    modifier.operation = 'DIFFERENCE'
    modifier.object = cutter
    modifier.solver = 'EXACT'
    kit.apply_modifiers(obj)
    bpy.data.objects.remove(cutter, do_unlink=True)

    limit = size / 2 - depth * 0.35
    kit.paint(obj, body)
    kit.paint(obj, pip, faces=lambda c, n: max(abs(c.x), abs(c.y), abs(c.z)) < limit)
    kit.assign(obj, 'lacquer')
    kit.smooth(obj, 35.0)
    return obj


def doubling_cube(name, size=0.032, showing=64):
    obj = kit.box(name, size=(size, size, size), bevel_width=0)
    kit.finish(obj, size * 0.09, segments=3, angle=35.0)
    order = {1: 64, 6: 2, 2: 4, 5: 32, 3: 8, 4: 16}
    faces = {normal: order[value] for normal, value in DIE_FACES.items()}
    ivory = _swatch('ivory')

    def mapper(face, co):
        n = face.normal
        best = None
        for normal, number in faces.items():
            dot = n.x * normal[0] + n.y * normal[1] + n.z * normal[2]
            if best is None or dot > best[0]:
                best = (dot, normal, number)
        dot, normal, number = best
        if dot < 0.85:
            return ivory
        nv = Vector(normal)
        axis_a = Vector((0, 1, 0)) if abs(nv.y) < 0.5 else Vector((1, 0, 0))
        axis_b = nv.cross(axis_a).normalized()
        axis_a = axis_b.cross(nv).normalized()
        u = 0.5 + co.dot(axis_a) / size
        v = 0.5 + co.dot(axis_b) / size
        rect = atlas.uv_rect('cube-%d' % number)
        return (rect[0] + (rect[2] - rect[0]) * u, rect[1] + (rect[3] - rect[1]) * v)

    kit.uv_map(obj, mapper)
    kit.paint(obj, 'white')
    kit.assign(obj, 'print')
    return obj


def dice_cup(name, radius=0.023, height=0.075, wall=0.0025):
    profile = [
        (0.0, 0.0),
        (radius - 0.002, 0.0),
        (radius, 0.002),
        (radius + 0.002, height - 0.006),
        (radius + 0.0035, height - 0.003),
        (radius + 0.0035, height),
        (radius + 0.001, height),
        (radius - wall, height - 0.004),
        (radius - wall - 0.001, wall + 0.001),
        (0.0, wall)
    ]
    obj = kit.lathe(name, profile, sides=36)
    kit.paint(obj, 'leather')
    kit.paint(obj, 'leather_dark', faces=lambda c, n: math.hypot(c.x, c.y) < radius - wall * 0.5 and c.z > wall)
    kit.assign(obj, 'leather')
    kit.smooth(obj, 40.0)
    return obj


def bowl(name, radius=0.055, height=0.030, colour_name='ivory'):
    profile = [
        (0.0, 0.0),
        (radius * 0.45, 0.0),
        (radius * 0.55, 0.003),
        (radius * 0.9, height * 0.6),
        (radius, height),
        (radius - 0.003, height),
        (radius * 0.86, height * 0.62),
        (radius * 0.5, 0.006),
        (0.0, 0.005)
    ]
    obj = kit.lathe(name, profile, sides=40)
    kit.paint(obj, colour_name)
    kit.assign(obj, 'lacquer')
    kit.smooth(obj, 40.0)
    return obj


def mound(name, radius=0.040, height=0.016, colour_name='enamel_sand'):
    profile = [(0.0, 0.0), (radius, 0.0)]
    for step in range(1, 9):
        a = math.pi / 2 * step / 8
        profile.append((math.cos(a) * radius, math.sin(a) * height))
    obj = kit.lathe(name, profile, sides=28)
    kit.paint(obj, colour_name)
    kit.assign(obj, 'enamel')
    kit.smooth(obj, 40.0)
    return obj


def estekan(name):
    glass = kit.lathe(name, [
        (0.0, 0.0),
        (0.021, 0.0),
        (0.023, 0.004),
        (0.020, 0.026),
        (0.017, 0.036),
        (0.021, 0.048),
        (0.026, 0.062),
        (0.027, 0.064),
        (0.025, 0.064),
        (0.024, 0.061),
        (0.019, 0.048),
        (0.015, 0.036),
        (0.018, 0.026),
        (0.020, 0.006),
        (0.0, 0.004)
    ], sides=36)
    kit.paint(glass, 'white')
    kit.assign(glass, 'glass')
    kit.smooth(glass, 40.0)

    tea = kit.lathe(name + '-tea', [
        (0.0, 0.005),
        (0.0195, 0.006),
        (0.0178, 0.026),
        (0.0148, 0.036),
        (0.0185, 0.047),
        (0.0, 0.047)
    ], sides=36)
    kit.paint(tea, '#8A3A12')
    kit.assign(tea, 'lacquer')
    kit.smooth(tea, 40.0)

    rim = kit.torus(name + '-rim', major=0.026, minor=0.0012, major_segments=36, minor_segments=8, location=(0, 0, 0.063))
    kit.paint(rim, 'brass')
    kit.assign(rim, 'brass')
    kit.smooth(rim, 40.0)

    saucer = kit.lathe(name + '-saucer', [
        (0.0, 0.0),
        (0.030, 0.0),
        (0.052, 0.006),
        (0.056, 0.010),
        (0.054, 0.011),
        (0.030, 0.004),
        (0.0, 0.003)
    ], sides=40)
    kit.paint(saucer, 'ivory')
    kit.assign(saucer, 'lacquer')
    kit.smooth(saucer, 40.0)
    for part in (glass, tea, rim):
        part.location.z += 0.004
    return [glass, tea, rim, saucer]


def dealer_button(name, diameter=0.051, thickness=0.008):
    r = diameter / 2
    profile = [(0.0, 0.0), (r - 0.0015, 0.0), (r, 0.0015), (r, thickness - 0.0015), (r - 0.0015, thickness), (0.0, thickness)]
    obj = kit.lathe(name, profile, sides=40)
    rect = atlas.uv_rect('button')
    white = _swatch('white')

    def mapper(face, co):
        if face.normal.z > 0.5:
            return (rect[0] + (rect[2] - rect[0]) * (0.5 + co.x / diameter), rect[1] + (rect[3] - rect[1]) * (0.5 + co.y / diameter))
        return white

    kit.uv_map(obj, mapper)
    kit.paint(obj, 'white')
    kit.assign(obj, 'print')
    kit.smooth(obj, 40.0)
    return obj


def score_sheet(name, width=0.105, height=0.090):
    obj = kit.rounded_plate(name, width, height, 0.0006, 0.002, corner_segments=2)
    rect = atlas.uv_rect('score')
    cream = _swatch('cream')

    def mapper(face, co):
        if face.normal.z > 0.5:
            return (rect[0] + (rect[2] - rect[0]) * ((co.x + width / 2) / width), rect[1] + (rect[3] - rect[1]) * ((co.y + height / 2) / height))
        return cream

    kit.uv_map(obj, mapper)
    kit.paint(obj, 'white')
    kit.assign(obj, 'print')
    return obj


def place(obj, x, y, z=0.0, yaw=0.0, pitch=0.0, roll=0.0):
    obj.location = (x, y, z)
    obj.rotation_euler = (roll, pitch, yaw)
    return obj


def fan(cards, cx, cy, z, facing, spread=6.0, pivot=0.075, bow=0.004):
    count = len(cards)
    for index, obj in enumerate(cards):
        t = (index - (count - 1) / 2)
        a = facing + math.radians(spread) * t
        x = cx + math.cos(a + math.pi / 2) * 0.0 - math.sin(a) * 0.0
        obj.location = (cx - math.cos(facing) * pivot + math.cos(a) * pivot, cy - math.sin(facing) * pivot + math.sin(a) * pivot, z + index * CARD_THICKNESS)
        lift = bow * (1.0 - (2.0 * index / max(count - 1, 1) - 1.0) ** 2)
        obj.location = (obj.location.x, obj.location.y, obj.location.z + lift)
        obj.rotation_euler = (0.0, 0.0, a - math.pi / 2)
    return cards
