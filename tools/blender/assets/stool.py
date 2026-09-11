import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from lib import furniture
from lib import kit

kit.reset_scene()

SEAT = 0.46
RADIUS = 0.17

cushion = kit.lathe('Cushion', [
    (0.0, SEAT - 0.06),
    (0.155, SEAT - 0.06),
    (0.168, SEAT - 0.055),
    (0.175, SEAT - 0.04),
    (0.176, SEAT - 0.022),
    (0.170, SEAT - 0.008),
    (0.155, SEAT - 0.001),
    (0.12, SEAT + 0.002),
    (0.06, SEAT + 0.004),
    (0.0, SEAT + 0.005)
], sides=44)
kit.paint(cushion, 'leather')
kit.smooth(cushion, 40.0)
kit.assign(cushion, 'leather')

piping = kit.torus('Piping', major=0.171, minor=0.0035, major_segments=44, minor_segments=8, location=(0, 0, SEAT - 0.004))
kit.paint(piping, 'leather_dark')
kit.smooth(piping, 50.0)
kit.assign(piping, 'leather')

frame_ring = kit.lathe('SeatFrame', [
    (0.0, SEAT - 0.085),
    (0.150, SEAT - 0.085),
    (0.158, SEAT - 0.08),
    (0.158, SEAT - 0.062),
    (0.0, SEAT - 0.062)
], sides=44)
kit.paint(frame_ring, 'walnut')
kit.smooth(frame_ring, 35.0)

legs = []
ferrules = []
SPLAY = math.atan2(0.045, SEAT - 0.085)
for index in range(4):
    angle = math.pi / 4 + index * math.pi / 2
    top_r = 0.115
    foot_r = top_r + 0.045
    length = math.hypot(0.045, SEAT - 0.085)
    leg = kit.lathe('Leg', [
        (0.0, 0.0),
        (0.015, 0.0),
        (0.019, 0.012),
        (0.017, 0.04),
        (0.016, 0.12),
        (0.021, 0.145),
        (0.017, 0.16),
        (0.018, 0.30),
        (0.021, length - 0.06),
        (0.024, length - 0.03),
        (0.024, length),
        (0.0, length)
    ], sides=20)
    kit.paint(leg, 'walnut_dark')
    kit.smooth(leg, 40.0)
    leg.location = (math.cos(angle) * foot_r, math.sin(angle) * foot_r, 0.0)
    leg.rotation_euler = (0.0, -SPLAY, angle)
    legs.append(leg)
    cap = furniture.ferrule('Ferrule', radius=0.019, height=0.014, location=(math.cos(angle) * foot_r, math.sin(angle) * foot_r, 0.0))
    ferrules.append(cap)

ring = kit.torus('FootRing', major=0.148, minor=0.008, major_segments=48, minor_segments=12, location=(0, 0, 0.165))
kit.paint(ring, 'brass')
kit.smooth(ring, 50.0)

for leg in legs:
    kit.select_only(leg)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for obj in [frame_ring] + legs:
    kit.uv_box(obj, scale=5.0, rotate=0.2)

wood = kit.join([frame_ring] + legs, 'Frame')
kit.assign(wood, 'wood')
trim = kit.join([ring] + ferrules, 'Trim')
kit.assign(trim, 'brass')

floor = kit.box('proxy', size=(1.5, 1.5, 0.02), location=(0, 0, -0.01), bevel_width=0)
kit.paint(floor, 'white')
parts = [cushion, piping, wood, trim]
kit.bake_ao(parts, distance=0.08, samples=40, strength=0.8)
bpy.data.objects.remove(floor, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'stool.png'), look_at=(0, 0, 0.25), distance=1.5, height=0.7, fov=34, yaw=0.5)

root = kit.parent(parts, 'Stool')
kit.export(kit.output_path('stool'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
