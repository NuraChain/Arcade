import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy

from lib import kit
from lib import settle
from lib import studio
from vignettes import backgammon
from vignettes import hokm
from vignettes import ludo
from vignettes import poker

GAMES = ['hokm', 'poker', 'backgammon', 'ludo']
BUILDERS = {'hokm': hokm.build, 'poker': poker.build, 'backgammon': backgammon.build, 'ludo': ludo.build}
ONLY = [game for game in os.environ.get('NURA_ONLY', '').split(',') if game] or [game for game in GAMES if game in BUILDERS]
PREVIEW = os.environ.get('NURA_PREVIEW') == '1'
PREVIEWS = os.path.join(HERE, 'out')


def decals():
    return [obj for obj in bpy.data.objects if obj.name.startswith('decal-')]


def preview(game, parts):
    shown = decals()
    for obj in shown:
        obj.hide_render = True
    bpy.ops.mesh.primitive_plane_add(size=24.0, location=(0.0, 0.0, 0.0))
    floor = bpy.context.active_object
    floor.name = 'preview-floor'
    kit.assign(floor, kit.material('preview-floor', base=studio.SPEC['sky'], roughness=1.0))
    studio.preview(os.path.join(PREVIEWS, 'showcase-%s.png' % game), **parts['hero'])
    if os.environ.get('NURA_TOP') == '1':
        studio.preview(os.path.join(PREVIEWS, 'showcase-%s-top.png' % game), (0.0, 0.0, 0.15), (0.0, -0.001, 1.25), fov=24.0, width=1200, height=1200)
    bpy.data.objects.remove(floor, do_unlink=True)
    for obj in shown:
        if obj.parent is parts['root']:
            obj.hide_render = False


kit.reset_scene()
settle.prepare()
studio.setup()

built = []
for game in ONLY:
    before = set(bpy.data.objects)
    parts = BUILDERS[game]()
    settle.rest()
    members = [obj for obj in bpy.data.objects if obj not in before and obj.type == 'MESH']
    settling = [obj for obj in parts['pieces'] if obj.get('settle') is not None]
    still = [obj for obj in parts['pieces'] if obj.get('settle') is None]
    everything = parts['surfaces'] + parts['raised'] + still
    for obj in settling:
        obj.hide_render = True
    studio.bake_floor(game, parts['root'], [parts['plinth']] + everything)
    studio.bake_contact(game, 'plinth', parts['root'], studio.PLINTH_HEIGHT, studio.PLINTH_RADIUS * 2.0, everything, [parts['plinth']] + decals())
    studio.bake_contact(game, 'surface', parts['root'], parts['surface_z'], parts['surface_size'], parts['raised'] + still, [parts['plinth']] + parts['surfaces'] + decals(), clip=parts.get('surface_clip'))
    for piece in settling:
        piece.hide_render = False
        if settle.resting_on(piece, parts['surface_z']):
            others = [obj for obj in settling if obj is not piece]
            spot = piece.matrix_world.translation
            footprint = studio.bake_contact(game, 'footprint-' + piece.name, parts['root'], parts['surface_z'], max(piece.dimensions) * 6.0, [piece], [parts['plinth']] + parts['surfaces'] + parts['raised'] + still + others + decals(), resolution=192, centre=(spot.x, spot.y), name='decal-footprint-' + piece.name, feather=True, lift=0.0002)
            settle.appear(footprint, piece['settle'] + '-shadow', piece['settle_land'])
        piece.hide_render = True
    for obj in settling:
        obj.hide_render = False
    if PREVIEW:
        preview(game, parts)
    for obj in members + decals():
        obj.hide_render = True
    built.append(parts)
    print('BUILT', game, len(members), 'meshes')


def descendants(root):
    found = [root]
    for child in root.children:
        found += descendants(child)
    return found


def merge(root):
    groups = {}
    for obj in descendants(root):
        if obj.type != 'MESH' or obj.data.users > 1 or obj.name.startswith('decal-') or obj.get('settle') is not None:
            continue
        key = tuple(slot.material.name for slot in obj.material_slots if slot.material is not None)
        groups.setdefault(key, []).append(obj)
    for objects in groups.values():
        if len(objects) > 1:
            kit.join(objects, objects[0].name)


def shrink(limit):
    for picture in bpy.data.images:
        if picture.size[0] == 0:
            continue
        width, height = picture.size
        largest = max(width, height)
        if largest > limit:
            scale = limit / largest
            picture.scale(max(1, round(width * scale)), max(1, round(height * scale)))


if ONLY == GAMES:
    for obj in bpy.data.objects:
        obj.hide_render = False
    for parts in built:
        merge(parts['root'])
    exported = [obj for parts in built for obj in descendants(parts['root'])]
    settle.rest()
    shrink(2048)
    for name in ('dark_wood_Diffuse_2k.jpg', 'dark_wood_Rough_2k.jpg', 'dark_wood_nor_gl_2k.jpg', 'scuba_suede_nor_gl_2k.jpg'):
        picture = bpy.data.images.get(name)
        if picture is not None and picture.size[0] > 1024:
            picture.scale(1024, 1024)
    kit.export(kit.output_path('showcase-desktop'), exported)
    settle.retarget(kit.output_path('showcase-desktop'))
    shrink(1024)
    for name in ('dark_wood_Diffuse_2k.jpg', 'dark_wood_Rough_2k.jpg', 'dark_wood_nor_gl_2k.jpg', 'scuba_suede_nor_gl_2k.jpg'):
        picture = bpy.data.images.get(name)
        if picture is not None and picture.size[0] > 512:
            picture.scale(512, 512)
    for picture in bpy.data.images:
        if picture.name.endswith('-plinth.png') or picture.name.endswith('-surface.png') or picture.name.endswith('-floor.png'):
            if picture.size[0] > 512:
                picture.scale(512, 512)
    kit.export(kit.output_path('showcase-phone'), exported, quality=82)
    settle.retarget(kit.output_path('showcase-phone'))
    print('EXPORTED', len(exported), 'objects')

