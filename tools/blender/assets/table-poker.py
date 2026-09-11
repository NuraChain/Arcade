import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy
from mathutils import Matrix

from lib import furniture
from lib import kit

kit.reset_scene()

RAIL_TOP = 0.762
FELT_TOP = RAIL_TOP - 0.018
A, B = 1.0, 0.575
RAIL_W = 0.12
TRACK_W = 0.065
SEGS = 72

rail_path = kit.ellipse_path(A, B, SEGS)
rail = kit.sweep('Rail', [
    (0.0, RAIL_TOP - 0.038),
    (0.004, RAIL_TOP - 0.030),
    (0.006, RAIL_TOP - 0.018),
    (0.003, RAIL_TOP - 0.008),
    (-0.010, RAIL_TOP - 0.002),
    (-0.035, RAIL_TOP),
    (-RAIL_W + 0.035, RAIL_TOP),
    (-RAIL_W + 0.012, RAIL_TOP - 0.003),
    (-RAIL_W + 0.003, RAIL_TOP - 0.010),
    (-RAIL_W, RAIL_TOP - 0.020),
    (-RAIL_W, RAIL_TOP - 0.038)
], rail_path, close_profile=True)
kit.paint(rail, 'leather_dark')
kit.smooth(rail, 40.0)
kit.assign(rail, 'leather')

track = kit.sweep('Track', [
    (-RAIL_W + 0.002, RAIL_TOP - 0.038),
    (-RAIL_W + 0.002, FELT_TOP + 0.0015),
    (-RAIL_W - TRACK_W + 0.003, FELT_TOP + 0.0015),
    (-RAIL_W - TRACK_W, FELT_TOP - 0.001),
    (-RAIL_W - TRACK_W, RAIL_TOP - 0.038)
], rail_path, close_profile=True)
kit.paint(track, 'walnut')
kit.smooth(track, 40.0)

felt = furniture.felt('Felt', 1.0, FELT_TOP, sides=SEGS, rings=10, thickness=0.006)
kit.transform(felt, Matrix.Diagonal((A - RAIL_W - TRACK_W + 0.012, B - RAIL_W - TRACK_W + 0.012, 1.0, 1.0)))
kit.assign(felt, 'felt')

line_a = A - RAIL_W - TRACK_W - 0.15
line_b = B - RAIL_W - TRACK_W - 0.15
line = kit.sweep('BettingLine', [(0.0, FELT_TOP - 0.001), (0.0, FELT_TOP + 0.0005), (-0.006, FELT_TOP + 0.0005), (-0.006, FELT_TOP - 0.001)], kit.ellipse_path(line_a, line_b, SEGS), close_profile=True)
kit.paint(line, 'ivory_dim')
kit.assign(line, 'ivory')

cups = []
for angle in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4):
    cx = math.cos(angle) * (A - RAIL_W - TRACK_W / 2 - 0.002)
    cy = math.sin(angle) * (B - RAIL_W - TRACK_W / 2 - 0.002)
    ring = kit.lathe('Cup', [(0.028, FELT_TOP - 0.03), (0.036, FELT_TOP - 0.03), (0.036, FELT_TOP + 0.0015), (0.040, FELT_TOP + 0.0035), (0.033, FELT_TOP + 0.0035), (0.030, FELT_TOP + 0.001), (0.030, FELT_TOP - 0.028), (0.028, FELT_TOP - 0.03)], sides=32, location=(cx, cy, 0))
    kit.paint(ring, 'brass')
    kit.smooth(ring, 40.0)
    cups.append(ring)
    bottom = kit.lathe('CupFloor', [(0.0, FELT_TOP - 0.028), (0.029, FELT_TOP - 0.028), (0.029, FELT_TOP - 0.026), (0.0, FELT_TOP - 0.026)], sides=32, location=(cx, cy, 0))
    kit.paint(bottom, 'black')
    kit.smooth(bottom, 40.0)
    cups.append(bottom)

skirt = furniture.apron('Apron', kit.ellipse_path(A - 0.03, B - 0.03, SEGS), RAIL_TOP - 0.038, 0.0, height=0.07, thickness=0.026)
under = furniture.felt('Underside', 1.0, FELT_TOP - 0.006, sides=SEGS, rings=2, thickness=0.06)
kit.transform(under, Matrix.Diagonal((A - RAIL_W - TRACK_W + 0.012, B - RAIL_W - TRACK_W + 0.012, 1.0, 1.0)))
kit.paint(under, 'walnut_dark')

pedestals = []
collars = []
for x in (-0.46, 0.46):
    pedestals.append(furniture.pedestal('Pedestal', RAIL_TOP - 0.10, plinth=0.30, shaft=0.10, sides=48, location=(x, 0, 0)))
    collars.append(furniture.collar('Collar', 0.104, RAIL_TOP - 0.10 - 0.085, minor=0.009, sides=48))
    collars[-1].location = (x, 0, collars[-1].location.z)
    ring = kit.sweep('FootRing', [(0.0, 0.0), (0.012, 0.0), (0.016, 0.012), (0.012, 0.03), (0.0, 0.034)], kit.ellipse_path(0.30, 0.30, 48), close_profile=True, location=(x, 0, 0))
    kit.paint(ring, 'brass')
    kit.smooth(ring, 50.0)
    collars.append(ring)

for obj in [track, skirt, under] + pedestals:
    kit.uv_box(obj, scale=5.0, rotate=0.4)

wood = kit.join([track, skirt, under] + pedestals, 'Frame')
kit.assign(wood, 'wood')
trim = kit.join(cups + collars, 'Trim')
kit.assign(trim, 'brass')

floor = kit.box('proxy', size=(4.0, 3.0, 0.02), location=(0, 0, -0.01), bevel_width=0)
kit.paint(floor, 'white')
parts = [rail, wood, felt, line, trim]
kit.bake_ao(parts, distance=0.10, samples=40, strength=0.8)
bpy.data.objects.remove(floor, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'table-poker.png'), look_at=(0, 0, 0.55), distance=3.4, height=1.6, fov=34, yaw=0.6)

root = kit.parent(parts, 'PokerTable')
kit.export(kit.output_path('table-poker'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
