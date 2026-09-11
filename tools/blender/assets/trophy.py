import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from lib import kit

kit.reset_scene()

plinth = kit.box('plinth', size=(0.34, 0.34, 0.07), location=(0, 0, 0.035))
kit.paint(plinth, 'wood_dark')

plinth_top = kit.box('plinth-top', size=(0.26, 0.26, 0.045), location=(0, 0, 0.092))
kit.paint(plinth_top, 'wood')

stem = kit.cylinder('stem', radius=0.032, depth=0.16, sides=10, location=(0, 0, 0.19))
kit.paint(stem, 'brass_dark')

knop = kit.sphere('knop', radius=0.052, segments=12, rings=6, location=(0, 0, 0.27))
kit.paint(knop, 'brass')

cup = kit.cone('cup', radius1=0.075, radius2=0.15, depth=0.20, sides=14, location=(0, 0, 0.40))
kit.paint(cup, 'brass')

lip = kit.torus('lip', major=0.15, minor=0.014, major_segments=14, minor_segments=5,
                location=(0, 0, 0.50))
kit.paint(lip, 'brass')

handles = []
for side in (-1, 1):
    handle = kit.torus('handle', major=0.062, minor=0.013, major_segments=12, minor_segments=5,
                       location=(side * 0.16, 0, 0.43))
    handle.rotation_euler = (1.5708, 0, 0)
    kit.paint(handle, 'brass')
    handles.append(handle)

base = kit.join([plinth, plinth_top], 'trophy-plinth')
kit.shade_flat(base)
kit.assign(base, 'wood')

metal = kit.join([stem, knop, cup, lip] + handles, 'trophy-cup')
kit.shade_flat(metal)
kit.assign(metal, 'brass')

for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.data.materials and obj.data.materials[0].name == 'wood':
        kit.uv_box(obj, scale=5.0, rotate=0.3)
kit.export(kit.output_path('trophy'), texcoords=True, compress=True)
