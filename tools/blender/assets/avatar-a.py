import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from lib import figure
from lib import kit

kit.reset_scene()

pose = figure.Pose(lean_angle=0.18, head_nod=0.24, head_turn=0.0, arms={'left': 'table', 'right': 'table'})
parts = figure.build(pose, shirt='white', trousers='charcoal', skin='skin_medium', hair='hair_black', hair_style='crop')

proxy = kit.cylinder('proxy', radius=0.17, depth=0.02, sides=24, location=(0, 0, -0.01), bevel_width=0)
kit.paint(proxy, 'white')
kit.bake_ao(parts, distance=0.08, samples=48, strength=0.8)
bpy.data.objects.remove(proxy, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'avatar-a-close.png'), look_at=(0, 0.1, 0.30), distance=1.7, height=0.6, fov=34, yaw=2.5)
kit.render_preview(os.path.join(out, 'avatar-a-side.png'), look_at=(0, 0.15, 0.25), distance=1.9, height=0.35, fov=34, yaw=1.45)

root = kit.parent(parts, 'Avatar')
kit.export(kit.output_path('avatar-a'), apply_modifiers_on_export=False, texcoords=False, compress=True, objects=parts + [root])
