import math
import os

import bpy
import numpy as np
from mathutils import Vector

from lib import kit
from lib import looks

SPEC = kit.studio()
PLINTH_RADIUS = SPEC['plinth']['radius']
PLINTH_HEIGHT = SPEC['plinth']['height']
FLOOR_SIZE = SPEC['floor']['size']
BAKES = os.path.join(kit.SCRATCH, 'bakes')


def blender_point(three):
    x, y, z = three
    return (x, -z, y)


def setup(samples=256):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    kit.use_gpu()
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'Khronos PBR Neutral'
    scene.view_settings.exposure = math.log2(SPEC['exposure'])
    world = bpy.data.worlds.new('studio')
    world.use_nodes = True
    tree = world.node_tree
    for node in list(tree.nodes):
        if node.type != 'OUTPUT_WORLD':
            tree.nodes.remove(node)
    dark = tree.nodes.new('ShaderNodeBackground')
    dark.inputs['Strength'].default_value = 0.0
    sky = tree.nodes.new('ShaderNodeBackground')
    sky.inputs['Color'].default_value = kit.srgb(SPEC['sky'])
    sky.inputs['Strength'].default_value = 1.0
    path = tree.nodes.new('ShaderNodeLightPath')
    mix = tree.nodes.new('ShaderNodeMixShader')
    tree.links.new(path.outputs['Is Camera Ray'], mix.inputs['Fac'])
    tree.links.new(dark.outputs['Background'], mix.inputs[1])
    tree.links.new(sky.outputs['Background'], mix.inputs[2])
    output = next(node for node in tree.nodes if node.type == 'OUTPUT_WORLD')
    tree.links.new(mix.outputs['Shader'], output.inputs['Surface'])
    scene.world = world
    panels()


def panels():
    made = []
    target = bpy.data.objects.new('studio-target', None)
    bpy.context.collection.objects.link(target)
    for panel in SPEC['panels']:
        width, height = panel['size']
        bpy.ops.mesh.primitive_plane_add(size=1.0, location=blender_point(panel['position']))
        obj = bpy.context.active_object
        obj.name = 'panel-' + panel['name']
        obj.scale = (width, height, 1.0)
        aim = obj.constraints.new('TRACK_TO')
        aim.target = target
        aim.track_axis = 'TRACK_NEGATIVE_Z'
        aim.up_axis = 'UP_Y'
        kit.assign(obj, kit.emission('panel-' + panel['name'], panel['colour'], panel['strength']))
        obj.visible_camera = False
        obj.visible_shadow = False
        made.append(obj)
    return made


def plinth(name):
    r = PLINTH_RADIUS
    h = PLINTH_HEIGHT
    profile = [
        (0.0, 0.0),
        (r - 0.05, 0.0),
        (r - 0.05, 0.016),
        (r - 0.012, 0.02),
        (r - 0.002, 0.026),
        (r, 0.034),
        (r, h - 0.012),
        (r - 0.0015, h - 0.0055),
        (r - 0.006, h - 0.0012),
        (r - 0.013, h),
        (0.0, h)
    ]
    obj = kit.lathe(name, profile, sides=128)
    kit.assign(obj, looks.plinth(), looks.plinth_band())
    kit.slot(obj, 1, lambda centre, normal: centre.z < 0.018)
    kit.smooth(obj, 30.0)
    return obj


def _camera_ortho(name, x, y, size, height=3.0):
    data = bpy.data.cameras.new(name)
    data.type = 'ORTHO'
    data.ortho_scale = size
    camera = bpy.data.objects.new(name, data)
    camera.location = (x, y, height)
    camera.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.collection.objects.link(camera)
    return camera


def _render(camera, resolution, path, transparent):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    loaded = bpy.data.images.load(path)
    pixels = np.array(loaded.pixels[:], dtype=np.float32).reshape(resolution, resolution, 4)
    bpy.data.images.remove(loaded)
    return pixels


def _visibility(objects, camera=None, shadow=None, render=None):
    for obj in objects:
        if camera is not None:
            obj.visible_camera = camera
        if shadow is not None:
            obj.visible_shadow = shadow
        if render is not None:
            obj.hide_render = not render


def _write_png(pixels, path):
    size = pixels.shape[0]
    picture = bpy.data.images.new(os.path.basename(path), size, size, alpha=True)
    picture.pixels.foreach_set(pixels.astype(np.float32).ravel())
    picture.filepath_raw = path
    picture.file_format = 'PNG'
    picture.save()
    bpy.data.images.remove(picture)
    return path


def _to_srgb(linear):
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(np.clip(linear, 0.0, None), 1.0 / 2.4) - 0.055)


def _decal_plane(name, size, z, path, parent):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0.0, 0.0, z))
    plane = bpy.context.active_object
    plane.name = name
    kit.uv_planar(plane, (0.0, 0.0, 1.0, 1.0), only_up=False)
    kit.assign(plane, kit.material(name, base_image=path, roughness=1.0, alpha=True))
    plane.parent = parent
    return plane


def bake_floor(game, root, members, resolution=512):
    os.makedirs(BAKES, exist_ok=True)
    bpy.ops.mesh.primitive_plane_add(size=FLOOR_SIZE, location=(0.0, 0.0, 0.0))
    floor = bpy.context.active_object
    floor.name = 'bake-floor'
    kit.assign(floor, kit.material('bake-white', base='#FFFFFF', roughness=1.0))
    camera = _camera_ortho('bake-floor-camera', 0.0, 0.0, FLOOR_SIZE)
    _visibility(members, camera=False, shadow=True)
    linear = _render(camera, resolution, os.path.join(BAKES, game + '-floor.exr'), False)
    _visibility(members, camera=True)
    bpy.data.objects.remove(floor, do_unlink=True)
    bpy.data.objects.remove(camera, do_unlink=True)

    light = linear[:, :, :3].mean(axis=2)
    axis = (np.arange(resolution) + 0.5) / resolution * 2.0 - 1.0
    distance = np.hypot(*np.meshgrid(axis, axis)) * FLOOR_SIZE / 2.0
    reference = np.percentile(light[(distance > PLINTH_RADIUS + 0.04) & (distance < PLINTH_RADIUS + 0.14)], 90)
    lit = np.clip(light / max(reference, 1e-6), 0.0, 1.0)
    edge = 0.98 * FLOOR_SIZE / 2.0
    fade = np.clip((edge - distance) / (edge - PLINTH_RADIUS), 0.0, 1.0)
    fade = fade * fade * (3.0 - 2.0 * fade)
    amount = (lit * fade)[:, :, None]
    void = np.array(kit.srgb(SPEC['sky'])[:3])
    pool = np.array(kit.srgb(SPEC['floor']['lit'])[:3])
    colour = void + (pool - void) * amount
    out = np.ones((resolution, resolution, 4), dtype=np.float32)
    out[:, :, :3] = _to_srgb(colour)
    path = _write_png(out, os.path.join(BAKES, game + '-floor.png'))
    return _decal_plane('decal-floor-' + game, FLOOR_SIZE, 0.0005, path, root)


def bake_contact(game, label, root, surface_z, size, casters, hidden, resolution=1024, clip=None):
    os.makedirs(BAKES, exist_ok=True)
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0.0, 0.0, surface_z))
    receiver = bpy.context.active_object
    receiver.name = 'bake-receiver'
    kit.assign(receiver, kit.material('bake-white', base='#FFFFFF', roughness=1.0))
    camera = _camera_ortho('bake-contact-camera', 0.0, 0.0, size, height=surface_z + 2.0)
    _visibility(hidden, render=False)
    _visibility(casters, camera=False, shadow=True)
    shadowed = _render(camera, resolution, os.path.join(BAKES, '%s-%s.exr' % (game, label)), False)
    _visibility(casters, render=False)
    open_sky = _render(camera, resolution, os.path.join(BAKES, '%s-%s-open.exr' % (game, label)), False)
    _visibility(casters, camera=True, render=True)
    _visibility(hidden, render=True)
    bpy.data.objects.remove(receiver, do_unlink=True)
    bpy.data.objects.remove(camera, do_unlink=True)

    lit = shadowed[:, :, :3].mean(axis=2)
    full = np.maximum(open_sky[:, :, :3].mean(axis=2), 1e-6)
    out = np.zeros((resolution, resolution, 4), dtype=np.float32)
    out[:, :, 3] = np.clip(1.0 - lit / full, 0.0, 1.0) * 0.92
    if clip is not None:
        axis = ((np.arange(resolution) + 0.5) / resolution - 0.5) * size
        across, along = np.meshgrid(axis, axis)
        out[:, :, 3] *= ((np.abs(across) <= clip[0] / 2.0) & (np.abs(along) <= clip[1] / 2.0)).astype(np.float32)
    path = _write_png(out, os.path.join(BAKES, '%s-%s.png' % (game, label)))
    return _decal_plane('decal-%s-%s' % (label, game), size, surface_z + 0.0001, path, root)


def preview(path, look_at, position, fov=32.0, width=1600, height=1000, samples=192):
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_depth = '8'
    scene.render.filepath = path
    target = bpy.data.objects.new('preview-target', None)
    target.location = look_at
    bpy.context.collection.objects.link(target)
    data = bpy.data.cameras.new('preview-camera')
    data.sensor_fit = 'VERTICAL'
    data.sensor_height = 24.0
    data.lens = 12.0 / math.tan(math.radians(fov) / 2)
    camera = bpy.data.objects.new('preview-camera', data)
    camera.location = position
    bpy.context.collection.objects.link(camera)
    aim = camera.constraints.new('TRACK_TO')
    aim.target = target
    aim.track_axis = 'TRACK_NEGATIVE_Z'
    aim.up_axis = 'UP_Y'
    scene.camera = camera
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.objects.remove(target, do_unlink=True)
