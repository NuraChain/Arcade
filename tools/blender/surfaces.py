import json
import math
import os
import sys
import urllib.request

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'application', 'public', 'board')
CACHE = os.path.join(HERE, 'scratch', 'textures')
ONLY = os.environ.get('NURA_SURFACE', '')
SAMPLES = int(os.environ.get('NURA_SAMPLES', '256'))

sys.path.insert(0, os.path.join(HERE, 'lib'))

from kit import lathe


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


def felt_table(key, pixels_w, pixels_h, colour, rim_ratio=0.045):
    width = pixels_w / 1000
    height = pixels_h / 1000
    scene = reset(pixels_w, pixels_h)
    rim = min(width, height) * rim_ratio
    lip = rim * 0.35
    inset = rim + lip

    walnut = wood_material('rim', 'dark_wood', 1.6, rotate=0.0, coat=0.3, tint=(0.78, 0.6, 0.5), space='Object')
    groove = flat_material('groove', (0.018, 0.009, 0.004), 0.55)
    baize = felt_material('baize', 'scuba_suede', 1.6, colour)
    brass = flat_material('brass', (0.8, 0.58, 0.26), 0.28)
    brass_shader = next(node for node in brass.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    brass_shader.inputs['Metallic'].default_value = 1.0

    frame('rim', rounded(width, height, rim * 1.6), rounded(width - rim * 2, height - rim * 2, rim * 1.1), 0.022, 0.0, walnut)
    band = rim * 0.62
    frame('inlay', rounded(width - band * 2 + 0.004, height - band * 2 + 0.004, rim * 1.35), rounded(width - band * 2 - 0.004, height - band * 2 - 0.004, rim * 1.33), 0.0226, 0.02, brass)
    frame('lip', rounded(width - rim * 2, height - rim * 2, rim * 1.1), rounded(width - inset * 2, height - inset * 2, rim * 0.9), 0.006, -0.002, groove)
    plane('felt', width - inset * 2 + 0.01, height - inset * 2 + 0.01, baize, z=0.0)

    lamp('lamp', (0.0, height * 0.45, 1.2), 1.4, 70.0, (1.0, 0.84, 0.64), aim=(0.0, -height * 0.05, 0.0))
    lamp('fill', (0.0, 0.0, 2.6), 3.0, 10.0, (0.75, 0.82, 1.0))
    camera(scene, max(width, height))
    scene.render.film_transparent = True
    save(scene, f'{key}.webp', alpha=True)


BAIZE = (0.022, 0.12, 0.065)


def hokm_table(key, pixels_w, pixels_h):
    felt_table(key, pixels_w, pixels_h, BAIZE)


def ludo_table():
    width, height = 1.6, 1.2
    scene = reset(1600, 1200)
    top = wood_material('tabletop', 'wood_table_001', 1.0, rotate=math.pi / 2, coat=0.0, tint=(1.0, 0.92, 0.86))
    plane('tabletop', width, height, top)
    lamp('lamp', (0.0, 0.5, 1.25), 1.6, 75.0, (1.0, 0.8, 0.58), aim=(0.0, -0.05, 0.0))
    lamp('fill', (0.0, 0.0, 2.6), 3.0, 8.0, (0.75, 0.82, 1.0))
    camera(scene, width)
    save(scene, 'ludo-table.webp')


def linear(hex_colour):
    value = hex_colour.lstrip('#')
    channels = [int(value[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    return tuple(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels)


def lacquer(name, colour, roughness=0.28, coat=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*colour, 1.0)
    shader.inputs['Roughness'].default_value = roughness
    if 'Coat Weight' in shader.inputs:
        shader.inputs['Coat Weight'].default_value = coat
        shader.inputs['Coat Roughness'].default_value = 0.06
    return material


def hdri(asset, resolution='1k'):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'{asset}_{resolution}.hdr')

    if os.path.exists(path):
        return path

    request = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers={'User-Agent': 'nura-games-build'})
    files = json.loads(urllib.request.urlopen(request).read())
    url = files['hdri'][resolution]['hdr']['url']
    download = urllib.request.Request(url, headers={'User-Agent': 'nura-games-build'})

    with urllib.request.urlopen(download) as response, open(path, 'wb') as target:
        target.write(response.read())

    return path


def studio(scene, asset, strength):
    world = scene.world
    tree = world.node_tree
    background = next(node for node in tree.nodes if node.type == 'BACKGROUND')
    environment = tree.nodes.new('ShaderNodeTexEnvironment')
    environment.image = bpy.data.images.load(hdri(asset))
    tree.links.new(environment.outputs['Color'], background.inputs['Color'])
    background.inputs['Strength'].default_value = strength


def geometry_of():
    with open(os.path.join(HERE, 'ludo-geometry.json'), encoding='utf-8') as source:
        return json.load(source)


def inks(geometry):
    return {colour: {shade: linear(value) for shade, value in shades.items()} for colour, shades in geometry['ink'].items()}


PAWN_PROFILE = [
    (0.000, 0.000), (0.380, 0.000), (0.405, 0.012), (0.410, 0.035), (0.410, 0.075), (0.400, 0.098), (0.372, 0.110),
    (0.352, 0.118), (0.340, 0.170), (0.312, 0.250), (0.270, 0.340), (0.222, 0.430), (0.180, 0.520), (0.155, 0.590), (0.146, 0.630)
] + [
    (0.28 * math.cos(math.radians(-59 + step * 149 / 12)), 0.88 + 0.28 * math.sin(math.radians(-59 + step * 149 / 12)))
    for step in range(12)
] + [(0.000, 1.160)]

PIECE_PX = 170.0
KEY = (-0.9, 1.0, 1.9)


def socket(sockets, name, kind):
    return next(one for one in sockets if one.name == name and one.type == kind)


def pawn_material(name, base, shade):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')
    weight = tree.nodes.new('ShaderNodeLayerWeight')
    weight.inputs['Blend'].default_value = 0.35
    ranged = tree.nodes.new('ShaderNodeMapRange')
    ranged.inputs['From Min'].default_value = 0.35
    ranged.inputs['From Max'].default_value = 1.0
    ranged.inputs['To Min'].default_value = 0.0
    ranged.inputs['To Max'].default_value = 0.55
    tree.links.new(weight.outputs['Facing'], ranged.inputs['Value'])
    mix = tree.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    tree.links.new(ranged.outputs['Result'], socket(mix.inputs, 'Factor', 'VALUE'))
    socket(mix.inputs, 'A', 'RGBA').default_value = (*base, 1.0)
    socket(mix.inputs, 'B', 'RGBA').default_value = (*shade, 1.0)
    tree.links.new(socket(mix.outputs, 'Result', 'RGBA'), shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = 0.2
    if 'Specular IOR Level' in shader.inputs:
        shader.inputs['Specular IOR Level'].default_value = 0.5
    if 'Coat Weight' in shader.inputs:
        shader.inputs['Coat Weight'].default_value = 1.0
        shader.inputs['Coat Roughness'].default_value = 0.04
    return material


def keyline_material(name, colour):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    for node in list(tree.nodes):
        if node.type == 'BSDF_PRINCIPLED':
            tree.nodes.remove(node)
    output = next(node for node in tree.nodes if node.type == 'OUTPUT_MATERIAL')
    emission = tree.nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (*colour, 1.0)
    emission.inputs['Strength'].default_value = 1.0
    clear = tree.nodes.new('ShaderNodeBsdfTransparent')
    facing = tree.nodes.new('ShaderNodeNewGeometry')
    mix = tree.nodes.new('ShaderNodeMixShader')
    tree.links.new(facing.outputs['Backfacing'], mix.inputs[0])
    tree.links.new(clear.outputs[0], mix.inputs[1])
    tree.links.new(emission.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], output.inputs['Surface'])
    return material


def camera_only(obj):
    obj.visible_diffuse = False
    obj.visible_glossy = False
    obj.visible_shadow = False
    obj.visible_transmission = False
    obj.visible_volume_scatter = False


def piece_camera(scene, tilt, target, span):
    data = bpy.data.cameras.new('piece')
    data.type = 'ORTHO'
    data.ortho_scale = span
    obj = bpy.data.objects.new('piece', data)
    view = Vector((0.0, math.sin(math.radians(tilt)), -math.cos(math.radians(tilt))))
    obj.location = Vector(target) - view * 20.0
    obj.rotation_euler = (math.radians(tilt), 0.0, 0.0)
    bpy.context.collection.objects.link(obj)
    scene.camera = obj
    return obj


def piece_lights(focus):
    reach = 12.0
    direction = Vector(KEY).normalized()
    lamp('key', tuple(direction * reach), 6.2, 800.0, (1.0, 0.97, 0.92), aim=focus)
    lamp('fill', (0.0, 0.0, 14.0), 16.0, 230.0, (0.92, 0.94, 1.0), aim=focus)
    rim = Vector((math.cos(math.radians(20)) * 0.7071, math.cos(math.radians(20)) * 0.7071, math.sin(math.radians(20)))) * reach
    lamp('rim', tuple(rim), 3.0, 200.0, (0.92, 0.95, 1.0), aim=focus)


def piece_scene(width, height):
    scene = reset(width, height)
    studio(scene, 'studio_small_09', 0.55)
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.film_transparent = True
    return scene


def pawn_mesh(material):
    pawn = lathe('pawn', PAWN_PROFILE, sides=96)
    pawn.data.materials.append(material)
    for polygon in pawn.data.polygons:
        polygon.use_smooth = True
    pawn.data.set_sharp_from_angle(angle=math.radians(40))
    return pawn


def ludo_pieces():
    geometry = geometry_of()
    ink = inks(geometry)
    up = Vector((0.0, 0.5, 0.866))
    span = 256 / PIECE_PX

    for colour in ink:
        scene = piece_scene(256, 256)
        pawn = pawn_mesh(pawn_material('pawn-' + colour, ink[colour]['base'], ink[colour]['shade']))
        hull = pawn.copy()
        hull.data = pawn.data.copy()
        hull.data.materials.clear()
        hull.data.materials.append(keyline_material('keyline-' + colour, ink[colour]['keyline']))
        bpy.context.collection.objects.link(hull)
        grow = hull.modifiers.new('grow', 'DISPLACE')
        grow.strength = 0.0375
        grow.mid_level = 0.0
        grow.direction = 'NORMAL'
        camera_only(hull)
        piece_lights((0.0, 0.0, 0.6))
        piece_camera(scene, 60.0, tuple(up * 0.4176), span)
        save(scene, 'pawn-' + colour + '.webp', quality=92, alpha=True)

    scene = piece_scene(256, 128)
    next(node for node in scene.world.node_tree.nodes if node.type == 'BACKGROUND').inputs['Strength'].default_value = 0.0
    pawn = pawn_mesh(pawn_material('pawn-shadow', ink['red']['base'], ink['red']['shade']))
    pawn.visible_camera = False
    bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.is_shadow_catcher = True
    across = Vector((KEY[0], KEY[1], 0.0)).normalized()
    high = across * math.cos(math.radians(68)) + Vector((0.0, 0.0, math.sin(math.radians(68))))
    lamp('key', tuple(high * 12.0), 5.0, 800.0, (1.0, 1.0, 1.0), aim=(0.0, 0.0, 0.6))
    lamp('contact', (0.0, 0.0, 6.0), 2.2, 180.0, (1.0, 1.0, 1.0), aim=(0.0, 0.0, 0.0))
    piece_camera(scene, 60.0, tuple(up * -0.1176), span)
    save(scene, 'pawn-shadow.webp', quality=92, alpha=True)

    ludo_dice()


PIPS = {
    1: [(0, 0)],
    2: [(-1, 1), (1, -1)],
    3: [(-1, 1), (0, 0), (1, -1)],
    4: [(-1, 1), (1, 1), (-1, -1), (1, -1)],
    5: [(-1, 1), (1, 1), (0, 0), (-1, -1), (1, -1)],
    6: [(-1, 1), (-1, 0), (-1, -1), (1, 1), (1, 0), (1, -1)]
}


def faces_for(value):
    around = [face for face in range(1, 7) if face not in (value, 7 - value)]
    south = min(around)
    east = min(face for face in around if face not in (south, 7 - south))
    return {
        (0, 0, 1): value,
        (0, 0, -1): 7 - value,
        (0, -1, 0): south,
        (0, 1, 0): 7 - south,
        (1, 0, 0): east,
        (-1, 0, 0): 7 - east
    }


def face_axes(normal):
    if normal[2] != 0:
        return Vector((1, 0, 0)), Vector((0, 1, 0))
    if normal[1] != 0:
        return Vector((1, 0, 0)), Vector((0, 0, 1))
    return Vector((0, 1, 0)), Vector((0, 0, 1))


def ludo_dice():
    scene = piece_scene(2048, 256)
    edge = 0.68
    grid = 0.27 * edge
    reach = 0.092
    depth = 0.046 * edge
    bone = lacquer('bone', linear('#F6F1E6'), roughness=0.28, coat=0.8)
    pip = lacquer('pip', linear('#2B1D12'), roughness=0.6, coat=0.0)

    for value in range(1, 7):
        x = value - 1 - 3.5
        bpy.ops.mesh.primitive_cube_add(size=edge, location=(x, 0.0, edge / 2))
        die = bpy.context.active_object
        die.name = 'die-' + str(value)
        die.data.materials.append(bone)
        rounding = die.modifiers.new('round', 'BEVEL')
        rounding.width = 0.16 * edge
        rounding.segments = 6
        rounding.limit_method = 'NONE'
        rounding.harden_normals = True
        for polygon in die.data.polygons:
            polygon.use_smooth = True
        cutters = []
        for normal, count in faces_for(value).items():
            n = Vector(normal)
            s, t = face_axes(normal)
            surface = Vector((x, 0.0, edge / 2)) + n * (edge / 2)
            for u, v in PIPS[count]:
                where = surface + s * (u * grid) + t * (v * grid) + n * (reach - depth)
                bpy.ops.mesh.primitive_uv_sphere_add(radius=reach, segments=32, ring_count=16, location=tuple(where))
                drill = bpy.context.active_object
                drill.data.materials.append(pip)
                for polygon in drill.data.polygons:
                    polygon.use_smooth = True
                cutters.append(drill)
        for index, drill in enumerate(cutters):
            drill.hide_render = True
            drill.hide_viewport = True
            modifier = die.modifiers.new(f'pip-{index}', 'BOOLEAN')
            modifier.operation = 'DIFFERENCE'
            modifier.solver = 'EXACT'
            modifier.object = drill
            modifier.material_mode = 'TRANSFER'
        weighted = die.modifiers.new('weighted', 'WEIGHTED_NORMAL')
        weighted.keep_sharp = True

    bpy.ops.mesh.primitive_plane_add(size=20.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.is_shadow_catcher = True
    piece_lights((0.0, 0.0, 0.3))
    piece_camera(scene, 10.0, (0.0, -0.04, edge / 2), 8.0)
    save(scene, 'ludo-dice.webp', quality=92, alpha=True)


SURFACES = {
    'ludo-table': ludo_table,
    'ludo-pieces': ludo_pieces,
    'hokm-table-wide': lambda: hokm_table('hokm-table-wide', 1600, 1000),
    'hokm-table-tall': lambda: hokm_table('hokm-table-tall', 1000, 1200)
}

for key, build in SURFACES.items():
    if ONLY == '' or ONLY == key:
        build()

sys.exit(0)
