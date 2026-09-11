import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from lib import kit

HERE = os.path.dirname(os.path.abspath(__file__))
WORLD = os.path.abspath(os.path.join(HERE, '..', '..', 'application', 'public', 'world'))
ART = os.path.abspath(os.path.join(HERE, '..', '..', 'application', 'public', 'art'))
ONLY = os.environ.get('NURA_ART')

GAMES = {
    'hokm': ('table-card', 1.25, 1.0, 0.42),
    'poker': ('table-poker', 1.35, 1.05, 0.35),
    'backgammon': ('table-board', 0.95, 0.78, 0.5),
    'ludo': ('table-board', 0.9, 0.75, 0.5)
}

def rebind_textures():
    for material in bpy.data.materials:
        material.use_backface_culling = False
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type != 'TEX_IMAGE' or node.image is None:
                continue
            name = material.name.split('.')[0]
            if name == 'print':
                node.image = kit.atlas_image()
            elif name == 'wood':
                node.image = kit.wood_image()


def import_glb(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(WORLD, name + '.glb'))
    bpy.context.view_layer.update()
    return [obj for obj in bpy.data.objects if obj not in before]


def span(parts, material=None):
    low = None
    high = None
    for obj in parts:
        if obj.type != 'MESH':
            continue
        if material is not None:
            names = [slot.material.name.split('.')[0] for slot in obj.material_slots if slot.material is not None]
            if material not in names:
                continue
        for vertex in obj.data.vertices:
            z = (obj.matrix_world @ vertex.co).z
            low = z if low is None else min(low, z)
            high = z if high is None else max(high, z)
    return low, high


def around(look_at, yaw, distance, height):
    return (look_at[0] + math.sin(yaw) * distance, look_at[1] - math.cos(yaw) * distance, look_at[2] + height)


def aim_at(obj, look_at):
    target = bpy.data.objects.new('art-target', None)
    target.location = look_at
    bpy.context.collection.objects.link(target)
    track = obj.constraints.new('TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'


def area_light(look_at, location, energy, size, colour_hex):
    bpy.ops.object.light_add(type='AREA', location=location)
    lamp = bpy.context.active_object
    lamp.data.energy = energy
    lamp.data.color = kit.srgb(colour_hex)[:3]
    lamp.data.size = size
    aim_at(lamp, look_at)
    return lamp


def arena_lights(look_at, yaw):
    area_light(look_at, around(look_at, yaw + 0.5, 1.2, 2.2), 300.0, 1.5, '#FFC46A')
    area_light(look_at, around(look_at, yaw + math.pi - 0.4, 2.0, 1.2), 60.0, 1.0, '#33D6C1')
    area_light(look_at, around(look_at, yaw - 1.4, 2.2, 1.0), 50.0, 2.5, '#7FB4C9')


def camera(look_at, distance, height, yaw, fov, width, height_px):
    scene = bpy.context.scene
    bpy.ops.object.camera_add(location=around(look_at, yaw, distance, height))
    cam = bpy.context.active_object
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_height = 24.0
    cam.data.lens = 12.0 / math.tan(math.radians(fov) / 2)
    aim_at(cam, look_at)
    scene.camera = cam
    scene.render.resolution_x = width
    scene.render.resolution_y = height_px
    scene.render.resolution_percentage = 100


def render(path, samples=128, exposure=0.0):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    kit.use_gpu()
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = exposure
    world = scene.world or bpy.data.worlds.new('art')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = kit.srgb('#0A1216')
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def save_webp(source_png, target, width, quality=86):
    image = bpy.data.images.load(source_png)
    image.scale(width, round(width * image.size[1] / image.size[0]))
    image.file_format = 'WEBP'
    scene = bpy.context.scene
    settings = scene.render.image_settings
    settings.file_format = 'WEBP'
    settings.quality = quality
    settings.color_mode = 'RGBA'
    os.makedirs(os.path.dirname(target), exist_ok=True)
    image.save_render(target, scene=scene)
    bpy.data.images.remove(image)


def game_art(game):
    table_name, distance, height, yaw = GAMES[game]
    kit.reset_scene()
    table = import_glb(table_name)
    felt = span(table, 'felt')[1]
    pieces = import_glb('set-' + game)
    resting = span(pieces)[0]
    for obj in pieces:
        if obj.parent is None:
            obj.location = (0.0, 0.0, felt - resting)
    bpy.context.view_layer.update()
    rebind_textures()
    ground = kit.lathe('shadow-ground', [(0.0, -0.002), (3.0, -0.002), (3.0, 0.0), (0.0, 0.0)], sides=48)
    ground.is_shadow_catcher = True
    look_at = (0.0, 0.0, felt + 0.04)
    arena_lights(look_at, yaw)
    camera(look_at, distance, height, yaw, 28.0, 1440, 960)
    png = os.path.join(HERE, 'out', 'art-' + game + '.png')
    render(png)
    save_webp(png, os.path.join(ART, 'games', game + '-1280.webp'), 1280)
    save_webp(png, os.path.join(ART, 'games', game + '-640.webp'), 640)
    print('ART', game, 'done')


if __name__ == '__main__':
    for game in GAMES:
        if ONLY in (None, 'games', game):
            game_art(game)
    print('ART_DONE')
