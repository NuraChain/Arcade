import math
import os

import bmesh
import bpy

from lib.kit import texture

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'application', 'public', 'board')
SAMPLES = int(os.environ.get('NURA_SAMPLES', '256'))


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


def wood_material(name, asset, scale, rotate=0.0, coat=0.35, tint=(1.0, 1.0, 1.0), space='UV'):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')

    coords = tree.nodes.new('ShaderNodeTexCoord')
    mapping = tree.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (scale, scale, 1.0)
    mapping.inputs['Rotation'].default_value = (0.0, 0.0, rotate)
    tree.links.new(coords.outputs[space], mapping.inputs['Vector'])

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


def save(scene, name, quality=82, alpha=False):
    settings = scene.render.image_settings
    settings.file_format = 'WEBP'
    settings.color_mode = 'RGBA' if alpha else 'RGB'
    settings.quality = quality
    scene.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print(f'surface {name}')


def rounded(width, height, radius, segments=10):
    points = []
    corners = [
        (width / 2 - radius, height / 2 - radius, 0.0),
        (-width / 2 + radius, height / 2 - radius, math.pi / 2),
        (-width / 2 + radius, -height / 2 + radius, math.pi),
        (width / 2 - radius, -height / 2 + radius, math.pi * 1.5)
    ]
    for cx, cy, start in corners:
        for step in range(segments + 1):
            angle = start + (math.pi / 2) * step / segments
            points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points


def frame(name, outer, inner, top, bottom, material):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    out_top = [bm.verts.new((x, y, top)) for x, y in outer]
    in_top = [bm.verts.new((x, y, top)) for x, y in inner]
    out_low = [bm.verts.new((x, y, bottom)) for x, y in outer]
    in_low = [bm.verts.new((x, y, bottom)) for x, y in inner]
    count = len(outer)
    for index in range(count):
        following = (index + 1) % count
        bm.faces.new((out_top[index], out_top[following], in_top[following], in_top[index]))
        bm.faces.new((out_low[index], out_low[following], out_top[following], out_top[index]))
        bm.faces.new((in_top[index], in_top[following], in_low[following], in_low[index]))
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    bevel = obj.modifiers.new('bevel', 'BEVEL')
    bevel.width = (top - bottom) * 0.45
    bevel.segments = 5
    bevel.limit_method = 'ANGLE'
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def felt_material(name, asset, scale, colour):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')

    coords = tree.nodes.new('ShaderNodeTexCoord')
    mapping = tree.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (scale, scale, 1.0)
    tree.links.new(coords.outputs['UV'], mapping.inputs['Vector'])

    base = image_node(tree, texture(asset, 'Diffuse'), True)
    normal = image_node(tree, texture(asset, 'nor_gl'), False)
    for node in (base, normal):
        tree.links.new(mapping.outputs['Vector'], node.inputs['Vector'])

    grey = tree.nodes.new('ShaderNodeRGBToBW')
    tree.links.new(base.outputs['Color'], grey.inputs['Color'])
    lift = tree.nodes.new('ShaderNodeMapRange')
    lift.inputs['To Min'].default_value = 0.72
    lift.inputs['To Max'].default_value = 1.12
    tree.links.new(grey.outputs['Val'], lift.inputs['Value'])
    tinted = tree.nodes.new('ShaderNodeMix')
    tinted.data_type = 'RGBA'
    tinted.blend_type = 'MULTIPLY'
    tinted.inputs['Factor'].default_value = 1.0
    tinted.inputs['A'].default_value = (*colour, 1.0)
    tree.links.new(lift.outputs['Result'], tinted.inputs['B'])

    mottle = tree.nodes.new('ShaderNodeTexNoise')
    mottle.inputs['Scale'].default_value = 7.0
    mottle.inputs['Detail'].default_value = 6.0
    mottle.inputs['Roughness'].default_value = 0.55
    tree.links.new(coords.outputs['Object'], mottle.inputs['Vector'])
    patches = tree.nodes.new('ShaderNodeMapRange')
    patches.inputs['To Min'].default_value = 0.86
    patches.inputs['To Max'].default_value = 1.1
    tree.links.new(mottle.outputs['Fac'], patches.inputs['Value'])
    mottled = tree.nodes.new('ShaderNodeMix')
    mottled.data_type = 'RGBA'
    mottled.blend_type = 'MULTIPLY'
    mottled.inputs['Factor'].default_value = 1.0
    tree.links.new(tinted.outputs['Result'], mottled.inputs['A'])
    tree.links.new(patches.outputs['Result'], mottled.inputs['B'])
    tree.links.new(mottled.outputs['Result'], shader.inputs['Base Color'])

    shader.inputs['Roughness'].default_value = 0.92
    if 'Specular IOR Level' in shader.inputs:
        shader.inputs['Specular IOR Level'].default_value = 0.1
    if 'Sheen Weight' in shader.inputs:
        shader.inputs['Sheen Weight'].default_value = 0.35
        shader.inputs['Sheen Tint'].default_value = (0.75, 0.95, 0.8, 1.0)

    bump = tree.nodes.new('ShaderNodeNormalMap')
    bump.inputs['Strength'].default_value = 1.0
    tree.links.new(normal.outputs['Color'], bump.inputs['Color'])

    fibres = tree.nodes.new('ShaderNodeTexNoise')
    fibres.inputs['Scale'].default_value = 900.0
    fibres.inputs['Detail'].default_value = 2.0
    tree.links.new(coords.outputs['Object'], fibres.inputs['Vector'])
    nap = tree.nodes.new('ShaderNodeBump')
    nap.inputs['Strength'].default_value = 0.18
    tree.links.new(fibres.outputs['Fac'], nap.inputs['Height'])
    tree.links.new(bump.outputs['Normal'], nap.inputs['Normal'])
    tree.links.new(nap.outputs['Normal'], shader.inputs['Normal'])

    return material


def flat_material(name, colour, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*colour, 1.0)
    shader.inputs['Roughness'].default_value = roughness
    return material
