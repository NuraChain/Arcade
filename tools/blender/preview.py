import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector
from lib import kit

HERE = os.path.dirname(os.path.abspath(__file__))
WORLD = os.path.abspath(os.path.join(HERE, '..', '..', 'application', 'public', 'world'))
OUT = os.environ.get('NURA_PREVIEW', os.path.join(HERE, 'preview.png'))

SPACING = 1.55

kit.reset_scene()

names = sorted(f[:-4] for f in os.listdir(WORLD) if f.endswith('.glb'))

only = os.environ.get('NURA_ONLY')
if only:
    names = [n for n in names if n == only]
if not names:
    print('PREVIEW: nothing built yet')
    sys.exit(0)

for index, name in enumerate(names):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(WORLD, name + '.glb'))
    imported = [o for o in bpy.data.objects if o not in before]

    x = (index - (len(names) - 1) / 2) * SPACING

    lowest = None
    for obj in imported:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
            z = (obj.matrix_world @ Vector(corner)).z
            lowest = z if lowest is None else min(lowest, z)

    lift = -lowest if lowest is not None and lowest < 0 else 0.0

    for obj in imported:
        if obj.parent is None:
            obj.location.x += x
            obj.location.z += lift

bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
ground = bpy.context.active_object
ground_mat = bpy.data.materials.new('ground')
ground_mat.use_nodes = True
ground_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = kit.srgb('#0A1216')
ground_mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
ground.data.materials.append(ground_mat)

bpy.ops.object.light_add(type='AREA', location=(1.5, -2.4, 6.0))
key = bpy.context.active_object
key.data.energy = 420
key.data.size = 7.0
key.data.color = kit.srgb('#FFC46A')[:3]
key.rotation_euler = (0.5, 0.25, 0)

bpy.ops.object.light_add(type='AREA', location=(-3.5, -2.5, 1.8))
fill = bpy.context.active_object
fill.data.energy = 120
fill.data.size = 6.0
fill.data.color = kit.srgb('#2B4E5E')[:3]
fill.rotation_euler = (1.1, -0.4, -0.5)

bpy.ops.object.light_add(type='AREA', location=(0, 4.5, 2.2))
rim = bpy.context.active_object
rim.data.energy = 300
rim.data.size = 5.0
rim.data.color = kit.srgb('#7FB4C9')[:3]
rim.rotation_euler = (-1.0, 0, 0)

world = bpy.data.worlds.new('market')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = kit.srgb('#0A1216')
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
bpy.context.scene.world = world

width = len(names) * SPACING
lens = 50.0
sensor = 36.0
distance = (width / 2) / math.tan(math.atan(sensor / 2 / lens)) * 1.06
height = 1.35
look_at = 0.45

bpy.ops.object.camera_add(location=(0, -distance, height))
camera = bpy.context.active_object
camera.data.lens = lens
camera.data.sensor_width = sensor
camera.rotation_euler = (math.pi / 2 - math.atan2(height - look_at, distance), 0, 0)
bpy.context.scene.camera = camera

scene = bpy.context.scene
for candidate in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
    try:
        scene.render.engine = candidate
        break
    except TypeError:
        continue

scene.render.resolution_x = 340 * len(names)
scene.render.resolution_y = 700
scene.render.film_transparent = False
scene.render.filepath = OUT
scene.view_settings.exposure = -0.9
scene.view_settings.view_transform = 'AgX'
for candidate in ('AgX - Base Contrast', 'AgX - Medium High Contrast', 'None'):
    try:
        scene.view_settings.look = candidate
        break
    except TypeError:
        continue

bpy.ops.render.render(write_still=True)
print('PREVIEW written to', OUT)
print('ORDER:', ', '.join(names))
