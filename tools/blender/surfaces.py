import json
import math
import os
import sys
import urllib.request

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'application', 'public', 'board')
CACHE = os.path.join(HERE, 'scratch', 'textures')
ONLY = os.environ.get('NURA_SURFACE', '')
SAMPLES = int(os.environ.get('NURA_SAMPLES', '256'))


def texture(asset, kind, resolution='2k'):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'{asset}_{kind}_{resolution}.jpg')

    if os.path.exists(path):
        return path

    request = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers={'User-Agent': 'nura-games-build'})
    files = json.loads(urllib.request.urlopen(request).read())
    url = files[kind][resolution]['jpg']['url']
    download = urllib.request.Request(url, headers={'User-Agent': 'nura-games-build'})

    with urllib.request.urlopen(download) as response, open(path, 'wb') as target:
        target.write(response.read())

    return path


def reset(width, height):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    scene.view_settings.view_transform = 'AgX'

    try:
        scene.view_settings.look = 'AgX - Punchy'
    except TypeError:
        pass

    world = bpy.data.worlds.new('room')
    world.use_nodes = True
    background = next(node for node in world.node_tree.nodes if node.type == 'BACKGROUND')
    background.inputs['Color'].default_value = (0.012, 0.016, 0.028, 1.0)
    background.inputs['Strength'].default_value = 0.35
    scene.world = world

    return scene


def image_node(tree, path, colour):
    node = tree.nodes.new('ShaderNodeTexImage')
    node.image = bpy.data.images.load(path)
    node.image.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return node


def wood_material(name, asset, scale, rotate=0.0, coat=0.35, tint=(1.0, 1.0, 1.0)):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')

    coords = tree.nodes.new('ShaderNodeTexCoord')
    mapping = tree.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (scale, scale, 1.0)
    mapping.inputs['Rotation'].default_value = (0.0, 0.0, rotate)
    tree.links.new(coords.outputs['UV'], mapping.inputs['Vector'])

    colour = image_node(tree, texture(asset, 'Diffuse'), True)
    rough = image_node(tree, texture(asset, 'Rough'), False)
    normal = image_node(tree, texture(asset, 'nor_gl'), False)

    for node in (colour, rough, normal):
        tree.links.new(mapping.outputs['Vector'], node.inputs['Vector'])

    tinted = tree.nodes.new('ShaderNodeMix')
    tinted.data_type = 'RGBA'
    tinted.blend_type = 'MULTIPLY'
    tinted.inputs['Factor'].default_value = 1.0
    tree.links.new(colour.outputs['Color'], tinted.inputs['A'])
    tinted.inputs['B'].default_value = (*tint, 1.0)
    tree.links.new(tinted.outputs['Result'], shader.inputs['Base Color'])

    ranged = tree.nodes.new('ShaderNodeMapRange')
    ranged.inputs['To Min'].default_value = 0.45
    ranged.inputs['To Max'].default_value = 0.85
    tree.links.new(rough.outputs['Color'], ranged.inputs['Value'])
    tree.links.new(ranged.outputs['Result'], shader.inputs['Roughness'])

    if 'Specular IOR Level' in shader.inputs:
        shader.inputs['Specular IOR Level'].default_value = 0.2

    bump = tree.nodes.new('ShaderNodeNormalMap')
    bump.inputs['Strength'].default_value = 0.7
    tree.links.new(normal.outputs['Color'], bump.inputs['Color'])
    tree.links.new(bump.outputs['Normal'], shader.inputs['Normal'])

    if 'Coat Weight' in shader.inputs:
        shader.inputs['Coat Weight'].default_value = coat
        shader.inputs['Coat Roughness'].default_value = 0.12

    return material


def plane(name, width, height, material, z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0.0, 0.0, z))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (width, height, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(material)
    return obj


def lamp(name, location, size, energy, colour, aim=(0.0, 0.0, 0.0), spread=180.0):
    data = bpy.data.lights.new(name, 'AREA')
    data.shape = 'DISK'
    data.size = size
    data.energy = energy
    data.color = colour
    data.spread = math.radians(spread)
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    bpy.context.collection.objects.link(obj)
    direction = (aim[0] - location[0], aim[1] - location[1], aim[2] - location[2])
    obj.rotation_euler = (math.atan2(direction[1], -direction[2]), math.atan2(-direction[0], -direction[2]), 0.0)
    return obj


def camera(scene, span):
    data = bpy.data.cameras.new('overhead')
    data.type = 'ORTHO'
    data.ortho_scale = span
    obj = bpy.data.objects.new('overhead', data)
    obj.location = (0.0, 0.0, 3.0)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.collection.objects.link(obj)
    scene.camera = obj
    return obj


def save(scene, name, quality=82):
    settings = scene.render.image_settings
    settings.file_format = 'WEBP'
    settings.color_mode = 'RGB'
    settings.quality = quality
    scene.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print(f'surface {name}')


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
    'ludo-table': ludo_table
}

for key, build in SURFACES.items():
    if ONLY == '' or ONLY == key:
        build()

sys.exit(0)
