import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib.tables import camera, flat_material, felt_material, frame, lamp, plane, reset, rounded, save, wood_material

ONLY = os.environ.get('NURA_SURFACE', '')


def felt_table(key, pixels_w, pixels_h, colour, rim_ratio=0.045):
    width = pixels_w / 1000
    height = pixels_h / 1000
    scene = reset(pixels_w, pixels_h)
    rim = min(width, height) * rim_ratio
    lip = rim * 0.35
    inset = rim + lip

    walnut = wood_material('rim', 'dark_wood', 1.6, rotate=0.0, coat=0.3, tint=(0.78, 0.6, 0.5), space='Object')
    groove = flat_material('groove', (0.018, 0.009, 0.004), 0.55)
    baize = felt_material('baize', 'scuba_suede', 1.6, colour)
    brass = flat_material('brass', (0.8, 0.58, 0.26), 0.28)
    brass_shader = next(node for node in brass.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    brass_shader.inputs['Metallic'].default_value = 1.0

    frame('rim', rounded(width, height, rim * 1.6), rounded(width - rim * 2, height - rim * 2, rim * 1.1), 0.022, 0.0, walnut)
    band = rim * 0.62
    frame('inlay', rounded(width - band * 2 + 0.004, height - band * 2 + 0.004, rim * 1.35), rounded(width - band * 2 - 0.004, height - band * 2 - 0.004, rim * 1.33), 0.0226, 0.02, brass)
    frame('lip', rounded(width - rim * 2, height - rim * 2, rim * 1.1), rounded(width - inset * 2, height - inset * 2, rim * 0.9), 0.006, -0.002, groove)
    plane('felt', width - inset * 2 + 0.01, height - inset * 2 + 0.01, baize, z=0.0)

    lamp('lamp', (0.0, height * 0.45, 1.2), 1.4, 70.0, (1.0, 0.84, 0.64), aim=(0.0, -height * 0.05, 0.0))
    lamp('fill', (0.0, 0.0, 2.6), 3.0, 10.0, (0.75, 0.82, 1.0))
    camera(scene, max(width, height))
    scene.render.film_transparent = True
    save(scene, f'{key}.webp', alpha=True)


BAIZE = (0.022, 0.12, 0.065)


def hokm_table(key, pixels_w, pixels_h):
    felt_table(key, pixels_w, pixels_h, BAIZE)


def ludo_table():
    width, height = 1.6, 1.2
    scene = reset(1600, 1200)
    top = wood_material('tabletop', 'wood_table_001', 1.0, rotate=math.pi / 2, coat=0.0, tint=(1.0, 0.92, 0.86))
    plane('tabletop', width, height, top)
    lamp('lamp', (0.0, 0.5, 1.25), 1.6, 75.0, (1.0, 0.8, 0.58), aim=(0.0, -0.05, 0.0))
    lamp('fill', (0.0, 0.0, 2.6), 3.0, 8.0, (0.75, 0.82, 1.0))
    camera(scene, width)
    save(scene, 'ludo-table.webp')


SURFACES = {
    'ludo-table': ludo_table,
    'hokm-table-wide': lambda: hokm_table('hokm-table-wide', 1600, 1000),
    'hokm-table-tall': lambda: hokm_table('hokm-table-tall', 1000, 1200)
}

for key, build in SURFACES.items():
    if ONLY == '' or ONLY == key:
        build()

sys.exit(0)
