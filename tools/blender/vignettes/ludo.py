import math

import bpy
from mathutils import Matrix

from lib import kit
from lib import looks
from lib import pieces
from lib import settle
from lib import studio

TOP = studio.PLINTH_HEIGHT
SIZE = 0.4
THICKNESS = 0.024
BOARD_TOP = TOP + THICKNESS

RIM = 0.016 / 0.380
FIELD = 1 - RIM * 2
MARGIN = RIM + FIELD * (16 / 992)
CELL = FIELD * (960 / 992) / 15
NEST = 3
SPREAD = 0.8
PAWN_SCALE = 0.92

YARDS = {'red': (NEST, NEST), 'green': (15 - NEST, NEST), 'blue': (NEST, 15 - NEST), 'yellow': (15 - NEST, 15 - NEST)}

PAWNS = [
    ('red', 'yard', (-1, -1)),
    ('red', 'yard', (1, 1)),
    ('red', 'cell', (3, 6)),
    ('green', 'yard', (-1, 1)),
    ('green', 'cell', (8, 3)),
    ('blue', 'yard', (1, -1)),
    ('blue', 'cell', (7, 11)),
    ('yellow', 'yard', (-1, -1)),
    ('yellow', 'yard', (1, 1)),
    ('yellow', 'cell', (11, 8))
]


def board_point(u, v):
    return (-SIZE / 2 + u * SIZE, SIZE / 2 - v * SIZE)


def cell_point(column, row):
    return board_point(MARGIN + (column + 0.5) * CELL, MARGIN + (row + 0.5) * CELL)


def seat_point(colour, well):
    column, row = YARDS[colour]
    return board_point(MARGIN + (column + well[0] * SPREAD) * CELL, MARGIN + (row + well[1] * SPREAD) * CELL)


def build():
    root = bpy.data.objects.new('ludo', None)
    bpy.context.collection.objects.link(root)

    plinth = studio.plinth('ludo-plinth')

    board = kit.rounded_plate('ludo-board', SIZE, SIZE, THICKNESS, SIZE * 0.032, corner_segments=8, location=(0.0, 0.0, TOP))

    def mapper(poly, co):
        if poly.normal.z > 0.5:
            return ((co.x + SIZE / 2) / SIZE, (co.y + SIZE / 2) / SIZE)
        return (0.02, 0.5)

    kit.uv_map(board, mapper)
    kit.assign(board, looks.ludo_board(), looks.ludo_side())
    kit.slot(board, 1, lambda centre, normal: normal.z < 0.5)
    kit.smooth(board, 30.0)

    prototypes = {}
    holder = bpy.data.objects.new('ludo-pawns', None)
    bpy.context.collection.objects.link(holder)
    holder.parent = root
    placed = []
    for index, (colour, kind, where) in enumerate(PAWNS):
        if colour not in prototypes:
            prototype = pieces.pawn('ludo-pawn-' + colour, colour)
            prototype.data.transform(Matrix.Scale(PAWN_SCALE, 4))
            prototypes[colour] = prototype
        x, y = seat_point(colour, where) if kind == 'yard' else cell_point(*where)
        copy = prototypes[colour].copy()
        copy.name = 'ludo-%s-%d' % (colour, index)
        bpy.context.collection.objects.link(copy)
        copy.location = (x, y, BOARD_TOP)
        copy.parent = holder
        placed.append(copy)
    for prototype in prototypes.values():
        bpy.data.objects.remove(prototype, do_unlink=True)

    die = pieces.die('ludo-die', 0.022, looks.sticker(), looks.ludo_ink())
    x, y = cell_point(8, 12)
    pieces.place(die, x, y, BOARD_TOP + 0.011, math.radians(24.0))
    settle.drop(die, 'settle-ludo', 0.24, (4.4, 2.2, 1.6), bounce=0.008)

    for obj in [plinth, board, die]:
        obj.parent = root

    return {
        'root': root,
        'plinth': plinth,
        'surfaces': [board],
        'raised': [],
        'pieces': placed + [die],
        'surface_z': BOARD_TOP,
        'surface_size': SIZE,
        'hero': {'look_at': (0.0, 0.0, 0.15), 'position': (0.34, -0.6, 0.52), 'fov': 30.0}
    }
