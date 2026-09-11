import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from lib import furniture
from lib import kit

kit.reset_scene()

TOP = 0.75
RADIUS = 1.10
RIM = 0.10
SIDES = 72

path = kit.ellipse_path(RADIUS, RADIUS, SIDES)
rim = furniture.rim('Rim', path, TOP, RIM, lip=0.004, depth=0.065)
inlay = furniture.inlay('Inlay', path, TOP, RIM - 0.004, width=0.006)
felt = furniture.felt('Felt', RADIUS - RIM + 0.004, TOP, sides=SIDES, rings=10)
under = furniture.underside('Underside', RADIUS - RIM + 0.004, TOP - 0.065, TOP - 0.006, sides=SIDES)
skirt = furniture.apron('Apron', kit.ellipse_path(RADIUS - 0.04, RADIUS - 0.04, SIDES), TOP - 0.065, 0.0, height=0.06, thickness=0.026)
column = furniture.pedestal('Pedestal', TOP - 0.065, plinth=0.50, shaft=0.13, sides=56)
band = furniture.collar('Collar', 0.135, TOP - 0.065 - 0.095, minor=0.011, sides=56)
foot_ring = kit.sweep('FootRing', [(0.0, 0.0), (0.012, 0.0), (0.016, 0.012), (0.012, 0.03), (0.0, 0.034)], kit.ellipse_path(0.50, 0.50, SIDES), close_profile=True)
kit.paint(foot_ring, 'brass')
kit.smooth(foot_ring, 50.0)

for obj in (rim, under, skirt, column):
    kit.uv_box(obj, scale=1.8, rotate=0.35)

wood = kit.join([rim, under, skirt, column], 'Frame')
kit.assign(wood, 'wood')
kit.assign(felt, 'felt')
trim = kit.join([inlay, band, foot_ring], 'Trim')
kit.assign(trim, 'brass')

floor = kit.box('proxy', size=(4.0, 4.0, 0.02), location=(0, 0, -0.01), bevel_width=0)
kit.paint(floor, 'white')
parts = [wood, felt, trim]
kit.bake_ao(parts, distance=0.10, samples=40, strength=0.8)
bpy.data.objects.remove(floor, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'table-round.png'), look_at=(0, 0, 0.55), distance=3.6, height=1.5, fov=34, yaw=0.5)

root = kit.parent(parts, 'RoundTable')
kit.export(kit.output_path('table-round'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
