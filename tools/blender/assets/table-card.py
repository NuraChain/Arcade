import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy
from mathutils import Matrix

from lib import furniture
from lib import kit

kit.reset_scene()

TOP = 0.74
APOTHEM = 0.76
RIM = 0.11
PHASE = math.pi / 8
CIRCUM = APOTHEM / math.cos(math.pi / 8)

path = kit.polygon_path(8, CIRCUM, PHASE)
rim = furniture.rim('Rim', path, TOP, RIM, lip=0.004, depth=0.06)
inlay = furniture.inlay('Inlay', path, TOP, RIM - 0.004, width=0.006)
felt_r = (APOTHEM - RIM + 0.004) / math.cos(math.pi / 8)
felt = furniture.felt('Felt', felt_r, TOP, sides=8, rings=9, phase=PHASE)
under = furniture.underside('Underside', felt_r, TOP - 0.06, TOP - 0.006, sides=8, phase=PHASE)
skirt = furniture.apron('Apron', kit.polygon_path(8, (APOTHEM - 0.045) / math.cos(math.pi / 8), PHASE), TOP - 0.06, 0.0, height=0.07, thickness=0.026)

column = kit.lathe('Column', [
    (0.0, 0.0),
    (0.40, 0.0),
    (0.40, 0.03),
    (0.36, 0.05),
    (0.26, 0.08),
    (0.17, 0.12),
    (0.13, 0.17),
    (0.115, 0.25),
    (0.108, 0.42),
    (0.118, 0.55),
    (0.15, 0.62),
    (0.21, 0.66),
    (0.21, TOP - 0.06),
    (0.0, TOP - 0.06)
], sides=8)
kit.transform(column, Matrix.Rotation(PHASE, 4, 'Z'))
kit.paint(column, 'walnut_dark')
kit.finish(column, 0.006, segments=3, angle=35.0)

band = furniture.collar('Collar', 0.125, 0.585, minor=0.010, sides=48)
foot_ring = kit.sweep('FootRing', [(0.0, 0.0), (0.012, 0.0), (0.016, 0.012), (0.012, 0.03), (0.0, 0.034)], kit.polygon_path(8, 0.40 / math.cos(math.pi / 8), PHASE), close_profile=True)
kit.paint(foot_ring, 'brass')
kit.smooth(foot_ring, 50.0)

for obj in (rim, under, skirt, column):
    kit.uv_box(obj, scale=5.0, rotate=0.3)

wood = kit.join([rim, under, skirt, column], 'Frame')
kit.assign(wood, 'wood')
kit.assign(felt, 'felt')
trim = kit.join([inlay, band, foot_ring], 'Trim')
kit.assign(trim, 'brass')

floor = kit.box('proxy', size=(3.0, 3.0, 0.02), location=(0, 0, -0.01), bevel_width=0)
kit.paint(floor, 'white')
parts = [wood, felt, trim]
kit.bake_ao(parts, distance=0.10, samples=40, strength=0.8)
bpy.data.objects.remove(floor, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'table-card.png'), look_at=(0, 0, 0.5), distance=3.0, height=1.4, fov=34, yaw=0.5)

root = kit.parent(parts, 'CardTable')
kit.export(kit.output_path('table-card'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
