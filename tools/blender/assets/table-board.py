import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy
from mathutils import Matrix

from lib import furniture
from lib import kit

kit.reset_scene()

TOP = 0.72
HALF = 0.50
RIM = 0.075
LEG = 0.415

path = kit.square_path(HALF, corner=0.035, corner_segments=5)
rim = furniture.rim('Rim', path, TOP, RIM, lip=0.004, depth=0.05)
inlay = furniture.inlay('Inlay', path, TOP, RIM - 0.004, width=0.005)

felt = kit.box('Felt', size=((HALF - RIM + 0.004) * 2, (HALF - RIM + 0.004) * 2, 0.006), location=(0, 0, TOP - 0.003), bevel_width=0)
kit.subdivide(felt, 12)
kit.paint(felt, 'felt')

under = kit.box('Underside', size=((HALF - RIM + 0.004) * 2, (HALF - RIM + 0.004) * 2, 0.044), location=(0, 0, TOP - 0.028), bevel_width=0)
kit.paint(under, 'walnut_dark')

skirt = furniture.apron('Apron', kit.square_path(HALF - 0.05, corner=0.01, corner_segments=2), TOP - 0.05, 0.0, height=0.075, thickness=0.024)

legs = []
caps = []
for sx in (-1, 1):
    for sy in (-1, 1):
        legs.append(furniture.turned_leg('Leg', TOP - 0.05, top_block=0.068, block_height=0.13, location=(sx * LEG, sy * LEG, 0)))
        caps.append(furniture.ferrule('Ferrule', radius=0.024, height=0.016, location=(sx * LEG, sy * LEG, 0)))
        caps.append(furniture.corner_cap('Cap', sx * (HALF - 0.032), sy * (HALF - 0.032), TOP + 0.004, size=0.05))

rails = [
    furniture.stretcher('Stretcher', (-LEG, -LEG, 0.16), (-LEG, LEG, 0.16)),
    furniture.stretcher('Stretcher', (LEG, -LEG, 0.16), (LEG, LEG, 0.16)),
    furniture.stretcher('Stretcher', (-LEG, 0, 0.16), (LEG, 0, 0.16))
]

for obj in [rim, under, skirt] + legs + rails:
    kit.uv_box(obj, scale=1.8, rotate=0.2)

wood = kit.join([rim, under, skirt] + legs + rails, 'Frame')
kit.assign(wood, 'wood')
kit.assign(felt, 'felt')
trim = kit.join([inlay] + caps, 'Trim')
kit.assign(trim, 'brass')

floor = kit.box('proxy', size=(3.0, 3.0, 0.02), location=(0, 0, -0.01), bevel_width=0)
kit.paint(floor, 'white')
parts = [wood, felt, trim]
kit.bake_ao(parts, distance=0.10, samples=40, strength=0.8)
bpy.data.objects.remove(floor, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'table-board.png'), look_at=(0, 0, 0.5), distance=2.4, height=1.2, fov=34, yaw=0.6)

root = kit.parent(parts, 'BoardTable')
kit.export(kit.output_path('table-board'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
