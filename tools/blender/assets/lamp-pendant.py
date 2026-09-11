import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from lib import kit

kit.reset_scene()

CORD_LENGTH = 1.15
SHADE_HEIGHT = 0.30
SHADE_RADIUS = 0.34

cord = kit.cylinder('cord', radius=0.012, depth=CORD_LENGTH, sides=8,
                    location=(0, 0, -CORD_LENGTH / 2))
kit.paint(cord, 'rope')

collar = kit.cylinder('collar', radius=0.045, depth=0.07, sides=10,
                      location=(0, 0, -CORD_LENGTH - 0.02))
kit.paint(collar, 'brass')

shade = kit.cone('shade', radius1=SHADE_RADIUS, radius2=0.11, depth=SHADE_HEIGHT, sides=14,
                 location=(0, 0, -CORD_LENGTH - 0.05 - SHADE_HEIGHT / 2))
kit.paint(shade, 'shade')

mouth_z = -CORD_LENGTH - 0.05 - SHADE_HEIGHT + 0.012
mouth = kit.cylinder('mouth', radius=SHADE_RADIUS * 0.93, depth=0.012, sides=14,
                     location=(0, 0, mouth_z))
kit.paint(mouth, 'lamp')

fitting = kit.join([cord, collar, shade], 'lamp-fitting')
kit.shade_flat(fitting)
kit.assign(fitting, 'wood')

kit.shade_flat(mouth)
kit.assign(mouth, 'glow')

for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.data.materials and obj.data.materials[0].name == 'wood':
        kit.uv_box(obj, scale=5.0, rotate=0.3)
kit.export(kit.output_path('lamp-pendant'), texcoords=True, compress=True)
