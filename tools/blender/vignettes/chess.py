import math

import bmesh
import bpy

from lib import kit
from lib import looks
from lib import settle
from lib import studio

TOP = studio.PLINTH_HEIGHT
SIZE = 0.42
THICKNESS = 0.026
BOARD_TOP = TOP + THICKNESS
FIELD = SIZE * 896 / 1000
SQUARE = FIELD / 8
TILE = 0.0012
FIELD_TOP = BOARD_TOP + TILE
REST = FIELD_TOP + 0.0003
SIDES = 16

WHITE = [
    ('a1', 'r'), ('b1', 'n'), ('c1', 'b'), ('d1', 'q'), ('e1', 'k'), ('f1', 'b'), ('h1', 'r'),
    ('a2', 'p'), ('b2', 'p'), ('c2', 'p'), ('d2', 'p'), ('e4', 'p'), ('f2', 'p'), ('g2', 'p'), ('h2', 'p')
]

BLACK = [
    ('a8', 'r'), ('b8', 'n'), ('c8', 'b'), ('d8', 'q'), ('e8', 'k'), ('f8', 'b'), ('g8', 'n'), ('h8', 'r'),
    ('a7', 'p'), ('b7', 'p'), ('c7', 'p'), ('d7', 'p'), ('e5', 'p'), ('f7', 'p'), ('g7', 'p'), ('h7', 'p')
]

KNIGHT = 'f3'

HEAD = [
    (0.0100, 0.0000), (0.0112, 0.0060), (0.0110, 0.0140), (0.0094, 0.0215), (0.0066, 0.0275),
    (0.0034, 0.0318), (0.0018, 0.0362), (-0.0006, 0.0330), (-0.0034, 0.0322), (-0.0088, 0.0276),
    (-0.0140, 0.0222), (-0.0170, 0.0188), (-0.0172, 0.0160), (-0.0150, 0.0142), (-0.0110, 0.0146),
    (-0.0082, 0.0124), (-0.0078, 0.0080), (-0.0094, 0.0030), (-0.0098, 0.0000)
]


def square_point(name):
    file = 'abcdefgh'.index(name[0])
    rank = int(name[1]) - 1
    return (-FIELD / 2 + (file + 0.5) * SQUARE, -FIELD / 2 + (rank + 0.5) * SQUARE)


def foot(r):
    return [(0.0, 0.0), (r, 0.0), (r * 1.04, r * 0.07), (r * 1.03, r * 0.21), (r * 0.95, r * 0.28), (r * 0.83, r * 0.31), (r * 0.8, r * 0.38)]


def collar(r, z, height):
    return [(r * 0.92, z), (r, z + height * 0.35), (r * 0.94, z + height), (r * 0.66, z + height * 1.2)]


def ball(r, z, steps=6):
    out = []
    for step in range(1, steps):
        angle = -math.pi / 2 + math.pi * step / steps
        out.append((math.cos(angle) * r, z + math.sin(angle) * r))
    return out + [(0.0, z + r)]


def turned(name, profile):
    obj = kit.lathe(name, profile, sides=SIDES)
    kit.smooth(obj, 50.0)
    return obj


def pawn(name):
    return turned(name, foot(0.014) + [(0.0100, 0.0070), (0.0076, 0.0150), (0.0064, 0.0212)] + collar(0.0092, 0.0216, 0.0022) + ball(0.0076, 0.0316))


def rook(name):
    body = turned(name, foot(0.016) + [(0.0118, 0.0085), (0.0106, 0.0335)] + [(0.0128, 0.0341), (0.0130, 0.0351), (0.0130, 0.0435), (0.0104, 0.0435), (0.0102, 0.0417), (0.0, 0.0417)])
    teeth = []
    for index in range(5):
        angle = index * math.tau / 5 + math.pi / 2
        teeth.append(kit.box('%s-tooth-%d' % (name, index), size=(0.0030, 0.0062, 0.0050), location=(math.cos(angle) * 0.0117, math.sin(angle) * 0.0117, 0.0457), rotation=(0.0, 0.0, angle), bevel_width=0))
    return kit.join([body] + teeth, name)


def bishop(name):
    mitre = [(0.0072, 0.0372), (0.0092, 0.0410), (0.0098, 0.0440), (0.0090, 0.0475), (0.0068, 0.0510), (0.0038, 0.0540), (0.0016, 0.0556)]
    body = turned(name, foot(0.015) + [(0.0110, 0.0080), (0.0082, 0.0200), (0.0060, 0.0316)] + collar(0.0094, 0.0320, 0.0024) + mitre + ball(0.0032, 0.0584))
    slit = kit.box(name + '-slit', size=(0.0016, 0.03, 0.03), location=(-0.0072, 0.0, 0.0498), rotation=(0.0, math.radians(-38.0), 0.0), bevel_width=0)
    cut = body.modifiers.new('Slit', 'BOOLEAN')
    cut.operation = 'DIFFERENCE'
    cut.object = slit
    cut.solver = 'EXACT'
    kit.apply_modifiers(body)
    bpy.data.objects.remove(slit, do_unlink=True)
    kit.smooth(body, 50.0)
    return body


def queen(name):
    crown = [(0.0076, 0.0540), (0.0112, 0.0606), (0.0118, 0.0636), (0.0098, 0.0642), (0.0062, 0.0634)]
    return turned(name, foot(0.0162) + [(0.0118, 0.0085), (0.0092, 0.0240), (0.0068, 0.0430)] + collar(0.0104, 0.0436, 0.0026) + crown + ball(0.0045, 0.0670))


def king(name):
    crown = [(0.0080, 0.0540), (0.0108, 0.0590), (0.0110, 0.0610), (0.0062, 0.0640), (0.0, 0.0646)]
    body = turned(name, foot(0.0168) + [(0.0122, 0.0088), (0.0096, 0.0240), (0.0072, 0.0420)] + collar(0.0110, 0.0426, 0.0028) + crown)
    upright = kit.box(name + '-upright', size=(0.0040, 0.0040, 0.0180), location=(0.0, 0.0, 0.0731), bevel_width=0.0006)
    arm = kit.box(name + '-arm', size=(0.0130, 0.0040, 0.0040), location=(0.0, 0.0, 0.0760), bevel_width=0.0006)
    return kit.join([body, upright, arm], name)


def carved(x, z):
    snout = min(max((x + 0.0172) / 0.0284, 0.0), 1.0)
    return (0.55 + 0.45 * snout) * (0.82 if z > 0.0300 else 1.0)


def knight(name):
    base = turned(name, foot(0.016) + [(0.0124, 0.0085), (0.0118, 0.0105), (0.0, 0.0105)])
    bm = bmesh.new()
    front = [bm.verts.new((x * 1.15, -0.0068 * carved(x, z), z * 1.15 + 0.0100)) for x, z in HEAD]
    grown = bmesh.ops.extrude_face_region(bm, geom=[bm.faces.new(front)])
    for vertex in grown['geom']:
        if isinstance(vertex, bmesh.types.BMVert):
            vertex.co.y = -vertex.co.y
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    head = kit.mesh_object(name + '-head', bm)
    kit.finish(head, 0.0020, segments=2, angle=35.0)
    return kit.join([base, head], name)


MAKERS = {'p': pawn, 'r': rook, 'b': bishop, 'q': queen, 'k': king, 'n': knight}


def field(name):
    half = FIELD / 2
    bm = bmesh.new()
    grid = [[bm.verts.new((-half + column * SQUARE, -half + row * SQUARE, FIELD_TOP)) for column in range(9)] for row in range(9)]
    for row in range(8):
        for column in range(8):
            bm.faces.new((grid[row][column], grid[row][column + 1], grid[row + 1][column + 1], grid[row + 1][column]))
    edge = [grid[0][column] for column in range(8)] + [grid[row][8] for row in range(8)] + [grid[8][column] for column in range(8, 0, -1)] + [grid[row][0] for row in range(8, 0, -1)]
    low = [bm.verts.new((vertex.co.x, vertex.co.y, BOARD_TOP)) for vertex in edge]
    for index in range(len(edge)):
        nxt = (index + 1) % len(edge)
        bm.faces.new((low[index], low[nxt], edge[nxt], edge[index]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = kit.mesh_object(name, bm)

    def cell(centre):
        return (math.floor((centre.x + half) / SQUARE), math.floor((centre.y + half) / SQUARE))

    def mapper(face, co):
        if face.normal.z < 0.5:
            return (co.x * 1.6, co.z * 1.6)
        column, row = cell(face.calc_center_median())
        return (co.x * 1.6, co.y * 1.6) if (column + row) % 2 == 0 else (co.y * 1.6, co.x * 1.6)

    kit.uv_map(obj, mapper)
    kit.assign(obj, looks.chess_square('maple', '#E9D3AA'), looks.chess_square('walnut', '#7A4E30'))
    kit.slot(obj, 1, lambda centre, normal: normal.z < 0.5 or sum(cell(centre)) % 2 == 0)
    return obj


def build():
    root = bpy.data.objects.new('chess', None)
    bpy.context.collection.objects.link(root)

    plinth = studio.plinth('chess-plinth')

    board = kit.rounded_plate('chess-board', SIZE, SIZE, THICKNESS, 0.01, corner_segments=6, location=(0.0, 0.0, TOP))
    kit.uv_box(board, scale=1.6)
    kit.assign(board, looks.walnut())
    kit.smooth(board, 30.0)

    squares = field('chess-field')

    reach = SIZE / 2 - SIZE * 52 * 0.42 / 1000
    inlay = kit.sweep('chess-inlay', [(-0.0005, BOARD_TOP - 0.0002), (-0.0005, BOARD_TOP + 0.0003), (0.0005, BOARD_TOP + 0.0003), (0.0005, BOARD_TOP - 0.0002)], kit.rect_path(reach, reach, 0.005, corner_segments=2))
    kit.assign(inlay, looks.brass())

    holder = bpy.data.objects.new('chess-pieces', None)
    bpy.context.collection.objects.link(holder)
    holder.parent = root
    prototypes = {}
    placed = []
    for colour, army, facing in (('white', WHITE, -28.0), ('black', BLACK, 152.0)):
        for index, (square, kind) in enumerate(army):
            if (colour, kind) not in prototypes:
                prototype = MAKERS[kind]('chess-%s-%s' % (colour, kind))
                kit.assign(prototype, looks.ivory() if colour == 'white' else looks.ebony())
                prototypes[(colour, kind)] = prototype
            x, y = square_point(square)
            copy = prototypes[(colour, kind)].copy()
            copy.name = 'chess-%s-%s' % (colour, square)
            bpy.context.collection.objects.link(copy)
            copy.location = (x, y, REST)
            yaw = facing if kind == 'n' else (62.0 if kind == 'b' else (index * 37 % 17 - 8))
            copy.rotation_euler = (0.0, 0.0, math.radians(yaw))
            copy.parent = holder
            placed.append(copy)
    for prototype in prototypes.values():
        bpy.data.objects.remove(prototype, do_unlink=True)

    hero = knight('chess-knight')
    kit.assign(hero, looks.ivory())
    x, y = square_point(KNIGHT)
    hero.location = (x, y, REST)
    hero.rotation_euler = (0.0, 0.0, math.radians(-28.0))
    settle.drop(hero, 'settle-chess', 0.16, (0.22, -0.14, 0.9), bounce=0.003, drift=(0.03, -0.02))

    for obj in [plinth, board, squares, inlay, hero]:
        obj.parent = root

    return {
        'root': root,
        'plinth': plinth,
        'surfaces': [board, squares, inlay],
        'raised': [],
        'pieces': placed + [hero],
        'surface_z': FIELD_TOP,
        'surface_size': SIZE,
        'surface_clip': (SIZE, SIZE),
        'hero': {'look_at': (0.0, 0.0, 0.14), 'position': (-0.3, -0.62, 0.52), 'fov': 30.0}
    }
