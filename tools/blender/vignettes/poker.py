import math

import bpy

from lib import kit
from lib import looks
from lib import pieces
from lib import settle
from lib import studio

TOP = studio.PLINTH_HEIGHT
SLAB_HEIGHT = 0.022
FELT_TOP = TOP + SLAB_HEIGHT + 0.004

STACKS = [
    ('red', 9, -0.128, 0.062),
    ('blue', 7, -0.086, 0.09),
    ('black', 5, -0.108, 0.018),
    ('green', 11, 0.126, 0.07),
    ('gold', 6, 0.092, 0.1),
    ('red', 3, -0.034, -0.034)
]
BOARD = [('QS', -0.07), ('JS', 0.0), ('10D', 0.07)]


def build():
    root = bpy.data.objects.new('poker', None)
    bpy.context.collection.objects.link(root)

    plinth = studio.plinth('poker-plinth')

    slab = kit.rounded_plate('poker-slab', 0.46, 0.36, SLAB_HEIGHT, 0.1, corner_segments=12, location=(0.0, 0.0, TOP))
    kit.uv_box(slab, scale=1.6)
    kit.assign(slab, looks.walnut())
    kit.smooth(slab, 30.0)

    felt = kit.rounded_plate('poker-felt', 0.41, 0.31, 0.004, 0.078, corner_segments=12, location=(0.0, 0.0, TOP + SLAB_HEIGHT))
    kit.uv_planar(felt, (0.0, 0.0, 1.0, 1.0), only_up=False)
    kit.assign(felt, looks.felt())

    base = TOP + SLAB_HEIGHT
    profile = [(-0.021, base), (-0.021, base + 0.008), (-0.017, base + 0.017), (-0.009, base + 0.0225), (0.0, base + 0.024), (0.009, base + 0.0225), (0.017, base + 0.017), (0.021, base + 0.008), (0.021, base)]
    rail = kit.sweep('poker-rail', profile, kit.rect_path(0.214, 0.164, 0.09, corner_segments=12))
    kit.assign(rail, looks.leather())
    kit.smooth(rail, 50.0)

    line = kit.sweep('poker-line', [(-0.0011, FELT_TOP - 0.0005), (-0.0011, FELT_TOP + 0.0005), (0.0011, FELT_TOP + 0.0005), (0.0011, FELT_TOP - 0.0005)], kit.rect_path(0.15, 0.1, 0.055, corner_segments=12))
    kit.assign(line, looks.brass())

    chips = {}
    placed = []
    holder = bpy.data.objects.new('poker-chips', None)
    bpy.context.collection.objects.link(holder)
    holder.parent = root
    for index, (colour, count, x, y) in enumerate(STACKS):
        if colour not in chips:
            chips[colour] = pieces.chip('poker-chip-' + colour, colour)
        placed += pieces.stack(chips[colour], count, x, y, FELT_TOP + 0.0002, seed=index + 1, parent=holder)
    settle.drop(placed[-1], 'settle-poker', 0.14, (0.5, 0.25, 2.6), fall=10, bounce=0.003)
    prototypes = list(chips.values())
    for prototype in prototypes:
        bpy.data.objects.remove(prototype, do_unlink=True)

    cards = []
    for index, (code, x) in enumerate(BOARD):
        card = pieces.card('poker-board-%d' % index, code)
        pieces.place(card, x, 0.028, FELT_TOP + 0.0004, math.radians(-1.5 + index * 1.5))
        cards.append(card)
    for index, (code, x, y, yaw) in enumerate([('AS', 0.004, -0.088, -9.0), ('KS', 0.03, -0.083, 7.0)]):
        card = pieces.card('poker-hole-%d' % index, code)
        pieces.place(card, x, y, FELT_TOP + 0.0004 + index * 0.0006, math.radians(yaw))
        cards.append(card)

    button = pieces.dealer_button('poker-button')
    for part in button:
        pieces.place(part, 0.104, -0.062, FELT_TOP + 0.0002)

    for obj in [plinth, slab, felt, rail, line] + cards + button:
        obj.parent = root

    return {
        'root': root,
        'plinth': plinth,
        'surfaces': [slab, felt],
        'raised': [rail, line],
        'pieces': placed + cards + button,
        'surface_z': FELT_TOP,
        'surface_size': 0.44,
        'hero': {'look_at': (0.0, 0.0, 0.15), 'position': (0.36, -0.6, 0.48), 'fov': 30.0}
    }
