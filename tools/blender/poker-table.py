import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib.kit import texture
from lib.tables import camera, flat_material, frame, image_node, lamp, reset, rounded, save, wood_material

ONLY = os.environ.get('NURA_SURFACE', '')

MARGIN = 0.012
RAIL = 0.085
TRACK = 0.05
GROOVE = 0.008
FELT = (0.006, 0.062, 0.056)


def stadium(width, height, segments=28):
    return rounded(width, height, min(width, height) / 2 * 0.999, segments)


def leather_material(name, asset, colour):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')

    coords = tree.nodes.new('ShaderNodeTexCoord')
    mapping = tree.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (5.0, 5.0, 5.0)
    tree.links.new(coords.outputs['Object'], mapping.inputs['Vector'])

    base = image_node(tree, texture(asset, 'Diffuse'), True)
    rough = image_node(tree, texture(asset, 'Rough'), False)
    normal = image_node(tree, texture(asset, 'nor_gl'), False)
    for node in (base, rough, normal):
        tree.links.new(mapping.outputs['Vector'], node.inputs['Vector'])

    grey = tree.nodes.new('ShaderNodeRGBToBW')
    tree.links.new(base.outputs['Color'], grey.inputs['Color'])
    lift = tree.nodes.new('ShaderNodeMapRange')
    lift.inputs['To Min'].default_value = 0.75
    lift.inputs['To Max'].default_value = 1.1
    tree.links.new(grey.outputs['Val'], lift.inputs['Value'])
    tinted = tree.nodes.new('ShaderNodeMix')
    tinted.data_type = 'RGBA'
    tinted.blend_type = 'MULTIPLY'
    tinted.inputs['Factor'].default_value = 1.0
    tinted.inputs['A'].default_value = (*colour, 1.0)
    tree.links.new(lift.outputs['Result'], tinted.inputs['B'])
    tree.links.new(tinted.outputs['Result'], shader.inputs['Base Color'])

    ranged = tree.nodes.new('ShaderNodeMapRange')
    ranged.inputs['To Min'].default_value = 0.42
    ranged.inputs['To Max'].default_value = 0.66
    tree.links.new(rough.outputs['Color'], ranged.inputs['Value'])
    tree.links.new(ranged.outputs['Result'], shader.inputs['Roughness'])

    bump = tree.nodes.new('ShaderNodeNormalMap')
    bump.inputs['Strength'].default_value = 0.9
    tree.links.new(normal.outputs['Color'], bump.inputs['Color'])
    tree.links.new(bump.outputs['Normal'], shader.inputs['Normal'])

    if 'Specular IOR Level' in shader.inputs:
        shader.inputs['Specular IOR Level'].default_value = 0.3
    if 'Coat Weight' in shader.inputs:
        shader.inputs['Coat Weight'].default_value = 0.16
        shader.inputs['Coat Roughness'].default_value = 0.18

    return material


def felt_material(name, asset, colour, span):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')

    coords = tree.nodes.new('ShaderNodeTexCoord')
    mapping = tree.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1.6 / span, 1.6 / span, 1.0)
    tree.links.new(coords.outputs['Object'], mapping.inputs['Vector'])

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
    patches.inputs['To Min'].default_value = 0.88
    patches.inputs['To Max'].default_value = 1.08
    tree.links.new(mottle.outputs['Fac'], patches.inputs['Value'])
    mottled = tree.nodes.new('ShaderNodeMix')
    mottled.data_type = 'RGBA'
    mottled.blend_type = 'MULTIPLY'
    mottled.inputs['Factor'].default_value = 1.0
    tree.links.new(tinted.outputs['Result'], mottled.inputs['A'])
    tree.links.new(patches.outputs['Result'], mottled.inputs['B'])

    glow = tree.nodes.new('ShaderNodeTexGradient')
    glow.gradient_type = 'SPHERICAL'
    spread = tree.nodes.new('ShaderNodeMapping')
    spread.inputs['Scale'].default_value = (1.35 / span, 1.35 / span, 1.0)
    tree.links.new(coords.outputs['Object'], spread.inputs['Vector'])
    tree.links.new(spread.outputs['Vector'], glow.inputs['Vector'])
    centre = tree.nodes.new('ShaderNodeMapRange')
    centre.inputs['To Min'].default_value = 0.78
    centre.inputs['To Max'].default_value = 1.22
    tree.links.new(glow.outputs['Fac'], centre.inputs['Value'])
    lit = tree.nodes.new('ShaderNodeMix')
    lit.data_type = 'RGBA'
    lit.blend_type = 'MULTIPLY'
    lit.inputs['Factor'].default_value = 1.0
    tree.links.new(mottled.outputs['Result'], lit.inputs['A'])
    tree.links.new(centre.outputs['Result'], lit.inputs['B'])
    tree.links.new(lit.outputs['Result'], shader.inputs['Base Color'])

    shader.inputs['Roughness'].default_value = 0.93
    if 'Specular IOR Level' in shader.inputs:
        shader.inputs['Specular IOR Level'].default_value = 0.08
    if 'Sheen Weight' in shader.inputs:
        shader.inputs['Sheen Weight'].default_value = 0.4
        shader.inputs['Sheen Tint'].default_value = (0.7, 0.95, 0.9, 1.0)

    bump = tree.nodes.new('ShaderNodeNormalMap')
    bump.inputs['Strength'].default_value = 1.0
    tree.links.new(normal.outputs['Color'], bump.inputs['Color'])

    fibres = tree.nodes.new('ShaderNodeTexNoise')
    fibres.inputs['Scale'].default_value = 900.0
    fibres.inputs['Detail'].default_value = 2.0
    tree.links.new(coords.outputs['Object'], fibres.inputs['Vector'])
    nap = tree.nodes.new('ShaderNodeBump')
    nap.inputs['Strength'].default_value = 0.16
    tree.links.new(fibres.outputs['Fac'], nap.inputs['Height'])
    tree.links.new(bump.outputs['Normal'], nap.inputs['Normal'])
    tree.links.new(nap.outputs['Normal'], shader.inputs['Normal'])

    return material


def disc(name, outline, z, material):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z)) for x, y in outline]
    bm.faces.new(verts)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def pillow(obj, depth):
    bevel = obj.modifiers['bevel']
    bevel.width = depth * 0.8
    bevel.segments = 12
    bevel.profile = 0.5


def poker_table(key, pixels_w, pixels_h):
    width = pixels_w / 1000
    height = pixels_h / 1000
    short = min(width, height)
    scene = reset(pixels_w, pixels_h)

    margin = short * MARGIN
    rail = short * RAIL
    track = short * TRACK
    groove = short * GROOVE

    leather = leather_material('rail', 'brown_leather', (0.009, 0.008, 0.0075))
    walnut = wood_material('track', 'dark_wood', 1.6, rotate=0.0, coat=0.4, tint=(0.8, 0.6, 0.48), space='Object')
    brass = flat_material('brass', (0.78, 0.52, 0.2), 0.34)
    brass_shader = next(node for node in brass.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    brass_shader.inputs['Metallic'].default_value = 1.0
    shadow = flat_material('groove', (0.012, 0.008, 0.005), 0.6)
    baize = felt_material('felt', 'scuba_suede', FELT, max(width, height))

    outer_w = width - margin * 2
    outer_h = height - margin * 2
    rail_in_w = outer_w - rail * 2
    rail_in_h = outer_h - rail * 2
    track_in_w = rail_in_w - track * 2
    track_in_h = rail_in_h - track * 2
    felt_w = track_in_w - groove * 2
    felt_h = track_in_h - groove * 2

    padded = frame('rail', stadium(outer_w, outer_h), stadium(rail_in_w, rail_in_h), 0.046, 0.0, leather)
    pillow(padded, 0.046)

    frame('track', stadium(rail_in_w + 0.004, rail_in_h + 0.004), stadium(track_in_w, track_in_h), 0.016, 0.0, walnut)
    middle = track * 0.5
    frame(
        'inlay',
        stadium(rail_in_w - middle * 2 + 0.006, rail_in_h - middle * 2 + 0.006),
        stadium(rail_in_w - middle * 2 - 0.006, rail_in_h - middle * 2 - 0.006),
        0.0166,
        0.012,
        brass
    )
    frame('groove', stadium(track_in_w + 0.002, track_in_h + 0.002), stadium(felt_w, felt_h), 0.004, -0.004, shadow)
    disc('felt', stadium(felt_w + 0.004, felt_h + 0.004), 0.0, baize)

    lamp('lamp', (0.0, height * 0.42, 1.25), 1.5, 78.0, (1.0, 0.85, 0.66), aim=(0.0, -height * 0.05, 0.0))
    lamp('fill', (0.0, 0.0, 2.6), 3.2, 12.0, (0.75, 0.82, 1.0))
    lamp('rim', (0.0, -height * 0.6, 0.9), 1.2, 14.0, (0.8, 0.88, 1.0), aim=(0.0, 0.0, 0.0))
    camera(scene, max(width, height))
    scene.render.film_transparent = True
    save(scene, f'{key}.webp', quality=84, alpha=True)


TABLES = {
    'poker-table-wide': lambda: poker_table('poker-table-wide', 1600, 1000),
    'poker-table-tall': lambda: poker_table('poker-table-tall', 1000, 1250)
}

for key, build in TABLES.items():
    if ONLY == '' or ONLY == key:
        build()

sys.exit(0)
