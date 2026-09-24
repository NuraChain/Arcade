import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy

from lib import kit
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
studio.setup()

built = []
for game in ONLY:
    before = set(bpy.data.objects)
    parts = BUILDERS[game]()
    members = [obj for obj in bpy.data.objects if obj not in before and obj.type == 'MESH']
    everything = parts['surfaces'] + parts['raised'] + parts['pieces']
    studio.bake_floor(game, parts['root'], [parts['plinth']] + everything)
    studio.bake_contact(game, 'plinth', parts['root'], studio.PLINTH_HEIGHT, studio.PLINTH_RADIUS * 2.0, everything, [parts['plinth']] + decals())
    studio.bake_contact(game, 'surface', parts['root'], parts['surface_z'], parts['surface_size'], parts['raised'] + parts['pieces'], [parts['plinth']] + parts['surfaces'] + decals())
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
        if obj.type != 'MESH' or obj.data.users > 1 or obj.name.startswith('decal-'):
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
    shrink(2048)
    for name in ('dark_wood_Diffuse_2k.jpg', 'dark_wood_Rough_2k.jpg', 'dark_wood_nor_gl_2k.jpg', 'scuba_suede_nor_gl_2k.jpg'):
        picture = bpy.data.images.get(name)
        if picture is not None and picture.size[0] > 1024:
            picture.scale(1024, 1024)
    kit.export(kit.output_path('showcase-desktop'), exported)
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
    print('EXPORTED', len(exported), 'objects')

