import bpy
import bmesh
import math
import os
from mathutils import Vector

import numpy as np


def output_dir():
    base = os.environ.get('NURA_OUT')
    if base is None:
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        base = os.path.join(here, '..', '..', 'application', 'public', 'world')
    os.makedirs(base, exist_ok=True)
    return os.path.abspath(base)


def output_path(name):
    return os.path.join(output_dir(), name + '.glb')


PALETTE = {
    'felt': '#1D5647',
    'felt_dark': '#143D33',
    'felt_light': '#276B59',
    'wood': '#6B4327',
    'wood_dark': '#4A2D19',
    'wood_light': '#8A5B37',
    'walnut': '#5A3A22',
    'walnut_dark': '#3E2716',
    'brass': '#B98A3C',
    'brass_dark': '#8A6528',
    'ivory': '#E8DCC4',
    'ivory_dim': '#CFC3A8',
    'bone': '#E9E1CF',
    'ebony': '#1E1A18',
    'leather': '#6B3F2A',
    'leather_dark': '#4E2C1D',
    'oxblood': '#6E1A1E',
    'enamel': '#C96F5A',
    'enamel_blue': '#4E7C8C',
    'enamel_green': '#5E8C63',
    'enamel_sand': '#D8A85E',
    'ludo_red': '#CC332E',
    'ludo_green': '#2E854D',
    'ludo_yellow': '#EDBD2E',
    'ludo_blue': '#2E66B8',
    'chip_white': '#F0EEE3',
    'chip_red': '#B31F24',
    'chip_blue': '#26529E',
    'chip_green': '#24704A',
    'chip_black': '#1A1A1C',
    'cream': '#F2EBD6',
    'lamp': '#FFB43D',
    'shade': '#2A3A40',
    'stone': '#33474F',
    'stone_dark': '#22343B',
    'rope': '#8C7A5E',
    'leaf': '#3E6B4F',
    'leaf_dark': '#2C4F3A',
    'white': '#F4F2EE',
    'black': '#141416',
    'charcoal': '#2B2B30',
    'navy': '#232C3F',
    'denim': '#3A4A66',
    'olive': '#5B5E3E',
    'skin_light': '#E6B896',
    'skin_medium': '#B97C57',
    'skin_deep': '#6A4229',
    'hair_black': '#1A1512',
    'hair_brown': '#4A2E1E',
    'hair_auburn': '#7A3F22',
    'hair_grey': '#8C8580'
}

MATERIALS = {
    'felt': {'roughness': 0.95, 'metallic': 0.0},
    'wood': {'roughness': 0.35, 'metallic': 0.0},
    'brass': {'roughness': 0.28, 'metallic': 0.20},
    'ivory': {'roughness': 0.70, 'metallic': 0.0},
    'enamel': {'roughness': 0.50, 'metallic': 0.0},
    'glow': {'roughness': 1.0, 'metallic': 0.0},
    'print': {'roughness': 0.55, 'metallic': 0.0},
    'leather': {'roughness': 0.70, 'metallic': 0.0},
    'lacquer': {'roughness': 0.18, 'metallic': 0.0, 'coat': 0.3},
    'glass': {'roughness': 0.05, 'metallic': 0.0, 'transmission': 0.9},
    'skin': {'roughness': 0.55, 'metallic': 0.0},
    'cloth': {'roughness': 0.85, 'metallic': 0.0},
    'hair': {'roughness': 0.45, 'metallic': 0.0}
}


def srgb(hex_colour, alpha=1.0):
    value = hex_colour.lstrip('#')
    out = []
    for index in (0, 2, 4):
        channel = int(value[index:index + 2], 16) / 255.0
        out.append(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], alpha)


def colour(name, alpha=1.0):
    return srgb(PALETTE[name], alpha) if name in PALETTE else srgb(name, alpha)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def atlas_image():
    existing = bpy.data.images.get('atlas')
    if existing is not None:
        return existing
    path = os.path.join(output_dir(), 'atlas-2048.webp')
    if os.path.exists(path):
        image = bpy.data.images.load(path)
    else:
        image = bpy.data.images.new('atlas', 8, 8)
        image.pixels.foreach_set(np.ones(8 * 8 * 4, dtype=np.float32))
    image.name = 'atlas'
    image.colorspace_settings.name = 'sRGB'
    return image


def wood_image():
    existing = bpy.data.images.get('wood')
    if existing is not None:
        return existing
    path = os.path.join(output_dir(), 'wood-512.webp')
    if os.path.exists(path):
        image = bpy.data.images.load(path)
    else:
        image = bpy.data.images.new('wood', 8, 8)
        image.pixels.foreach_set(np.ones(8 * 8 * 4, dtype=np.float32))
    image.name = 'wood'
    image.colorspace_settings.name = 'sRGB'
    return image


TEXTURED = {'print': atlas_image, 'wood': wood_image}


def _mix_colour_inputs(node):
    sockets = [socket for socket in node.inputs if socket.type == 'RGBA']
    return sockets[0], sockets[1]


def material(family):
    if family in bpy.data.materials:
        return bpy.data.materials[family]

    spec = MATERIALS[family]
    mat = bpy.data.materials.new(family)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = spec['roughness']
    bsdf.inputs['Metallic'].default_value = spec['metallic']
    if 'coat' in spec:
        bsdf.inputs['Coat Weight'].default_value = spec['coat']
    if 'transmission' in spec:
        bsdf.inputs['Transmission Weight'].default_value = spec['transmission']

    attribute = tree.nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'Col'

    if family in TEXTURED:
        image = tree.nodes.new('ShaderNodeTexImage')
        image.image = TEXTURED[family]()
        image.interpolation = 'Linear'
        mix = tree.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        a, b = _mix_colour_inputs(mix)
        tree.links.new(image.outputs['Color'], a)
        tree.links.new(attribute.outputs['Color'], b)
        tree.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    else:
        tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])

    if family == 'glow':
        tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 3.0

    return mat


def paint(obj, colour_name, faces=None):
    mesh = obj.data
    if 'Col' not in mesh.color_attributes:
        mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')

    layer = mesh.color_attributes['Col']
    rgba = colour(colour_name)

    for poly in mesh.polygons:
        if faces is not None and not faces(poly.center, poly.normal):
            continue
        for loop_index in poly.loop_indices:
            layer.data[loop_index].color = rgba


def assign(obj, family):
    obj.data.materials.clear()
    obj.data.materials.append(material(family))


def shade_flat(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = False


def select_only(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def smooth(obj, angle=30.0):
    select_only(obj)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle), keep_sharp_edges=False)


def bevel_modifier(obj, width, segments=3, angle=30.0, weighted=True):
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = True
    mod.miter_outer = 'MITER_ARC'
    mod.use_clamp_overlap = True
    if weighted:
        normals = obj.modifiers.new('WeightedNormal', 'WEIGHTED_NORMAL')
        normals.keep_sharp = True
    return mod


def apply_modifiers(obj):
    if not obj.modifiers:
        return
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    mesh.name = old.name
    bpy.data.meshes.remove(old)


def finish(obj, width, segments=3, angle=30.0):
    smooth(obj, angle)
    bevel_modifier(obj, width, segments, angle)
    apply_modifiers(obj)
    smooth(obj, angle)


def bevel(obj, width=0.01, segments=1):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    bmesh.ops.bevel(
        mesh,
        geom=list(mesh.verts) + list(mesh.edges),
        offset=width,
        segments=segments,
        profile=0.5,
        affect='EDGES'
    )
    mesh.to_mesh(obj.data)
    mesh.free()


def _auto_bevel(obj, requested):
    if requested == 0:
        return

    smallest = min(obj.dimensions)
    width = min(0.008, smallest * 0.12) if requested is None else min(requested, smallest * 0.45)

    if width > 0.0005:
        bevel(obj, width=width)


def box(name, size=(1, 1, 1), location=(0, 0, 0), rotation=(0, 0, 0), bevel_width=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    _auto_bevel(obj, bevel_width)
    return obj


def cylinder(name, radius=0.5, depth=1.0, sides=12, location=(0, 0, 0), rotation=(0, 0, 0), bevel_width=None):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=sides, location=location, rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    _auto_bevel(obj, bevel_width)
    return obj


def cone(name, radius1=0.5, radius2=0.0, depth=1.0, sides=12, location=(0, 0, 0), rotation=(0, 0, 0), bevel_width=None):
    bpy.ops.mesh.primitive_cone_add(
        radius1=radius1, radius2=radius2, depth=depth, vertices=sides,
        location=location, rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    _auto_bevel(obj, bevel_width)
    return obj


def sphere(name, radius=0.5, segments=12, rings=6, location=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, segments=segments, ring_count=rings, location=location
    )
    obj = bpy.context.active_object
    obj.name = name
    return obj


def torus(name, major=0.5, minor=0.08, major_segments=16, minor_segments=6, location=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=major_segments, minor_segments=minor_segments,
        location=location
    )
    obj = bpy.context.active_object
    obj.name = name
    return obj


def mesh_object(name, bm, location=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    bpy.context.collection.objects.link(obj)
    return obj


def lathe(name, profile, sides=48, location=(0, 0, 0)):
    bm = bmesh.new()
    chain = [bm.verts.new((radius, 0.0, z)) for radius, z in profile]
    edges = [bm.edges.new((chain[index], chain[index + 1])) for index in range(len(chain) - 1)]
    bmesh.ops.spin(
        bm,
        geom=chain + edges,
        cent=(0.0, 0.0, 0.0),
        axis=(0.0, 0.0, 1.0),
        angle=math.tau,
        steps=sides,
        use_merge=True,
        use_duplicate=False
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, location)


def rounded_plate(name, width, height, thickness, radius, corner_segments=5, location=(0, 0, 0)):
    bm = bmesh.new()
    loop = []
    corners = [
        (width / 2 - radius, height / 2 - radius, 0.0),
        (-(width / 2 - radius), height / 2 - radius, math.pi / 2),
        (-(width / 2 - radius), -(height / 2 - radius), math.pi),
        (width / 2 - radius, -(height / 2 - radius), -math.pi / 2)
    ]
    for cx, cy, start in corners:
        for step in range(corner_segments + 1):
            a = start + (math.pi / 2) * step / corner_segments
            loop.append(bm.verts.new((cx + math.cos(a) * radius, cy + math.sin(a) * radius, 0.0)))
    bottom = bm.faces.new(loop)
    result = bmesh.ops.extrude_face_region(bm, geom=[bottom])
    top_verts = [element for element in result['geom'] if isinstance(element, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top_verts, vec=(0.0, 0.0, thickness))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, location)


def uv_map(obj, mapper):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        for loop in face.loops:
            uv = mapper(face, loop.vert.co)
            if uv is not None:
                loop[layer].uv = uv
    bm.to_mesh(obj.data)
    bm.free()


def uv_fill(obj, u, v):
    uv_map(obj, lambda face, co: (u, v))


def uv_planar(obj, rect, axis='Z', extent=None, only_up=True):
    u0, v0, u1, v1 = rect
    coords = np.array([vertex.co for vertex in obj.data.vertices])
    axes = {'X': (1, 2), 'Y': (0, 2), 'Z': (0, 1)}[axis]
    normal_index = {'X': 0, 'Y': 1, 'Z': 2}[axis]
    if extent is None:
        lo = coords[:, list(axes)].min(axis=0)
        hi = coords[:, list(axes)].max(axis=0)
    else:
        lo = np.array(extent[0], dtype=np.float64)
        hi = np.array(extent[1], dtype=np.float64)
    span = np.maximum(hi - lo, 1e-6)

    def mapper(face, co):
        if only_up and face.normal[normal_index] < 0.5:
            return None
        s = (co[axes[0]] - lo[0]) / span[0]
        t = (co[axes[1]] - lo[1]) / span[1]
        return (u0 + (u1 - u0) * s, v0 + (v1 - v0) * t)

    uv_map(obj, mapper)


def subdivide(obj, cuts):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    bm.to_mesh(obj.data)
    bm.free()


def join(objects, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    merged = bpy.context.active_object
    merged.name = name
    return merged


def parent(children, name, location=(0, 0, 0)):
    root = bpy.data.objects.new(name, None)
    root.location = location
    bpy.context.collection.objects.link(root)
    for child in children:
        child.parent = root
    return root


def ring(count, radius, z=0.0, phase=0.0):
    out = []
    for index in range(count):
        angle = phase + (index / count) * math.tau
        out.append(Vector((math.cos(angle) * radius, math.sin(angle) * radius, z)))
    return out


def use_gpu():
    prefs = bpy.context.preferences.addons.get('cycles')
    if prefs is None:
        return
    settings = prefs.preferences
    for backend in ('OPTIX', 'CUDA'):
        try:
            settings.compute_device_type = backend
            settings.get_devices()
            wanted = [device for device in settings.devices if device.type == backend]
            if wanted:
                for device in settings.devices:
                    device.use = device.type in (backend, 'CPU')
                bpy.context.scene.cycles.device = 'GPU'
                return
        except Exception:
            continue
    bpy.context.scene.cycles.device = 'CPU'


def bake_ao(objects, distance=0.06, samples=48, strength=0.85):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    use_gpu()
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = False
    scene.cycles.bake_type = 'AO'
    if scene.world is None:
        scene.world = bpy.data.worlds.new('bake')
    scene.world.light_settings.distance = distance
    scene.render.bake.target = 'VERTEX_COLORS'
    scene.render.bake.use_clear = True

    for obj in objects:
        mesh = obj.data
        if 'AO' not in mesh.color_attributes:
            mesh.color_attributes.new(name='AO', type='FLOAT_COLOR', domain='CORNER')
        mesh.color_attributes.active_color_index = list(mesh.color_attributes.keys()).index('AO')

    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)

    for obj in objects:
        mesh = obj.data
        count = len(mesh.loops) * 4
        occlusion = np.empty(count, dtype=np.float32)
        base = np.empty(count, dtype=np.float32)
        mesh.color_attributes['AO'].data.foreach_get('color', occlusion)
        mesh.color_attributes['Col'].data.foreach_get('color', base)
        occlusion = occlusion.reshape(-1, 4)
        base = base.reshape(-1, 4)
        factor = 1.0 - strength * (1.0 - occlusion[:, :1])
        base[:, :3] *= np.clip(factor, 0.0, 1.0)
        mesh.color_attributes['Col'].data.foreach_set('color', base.ravel())
        mesh.color_attributes.remove(mesh.color_attributes['AO'])
        mesh.color_attributes.active_color_index = list(mesh.color_attributes.keys()).index('Col')
        mesh.update()


def export(path, apply_modifiers_on_export=True, texcoords=False, compress=False, objects=None):
    if objects is None:
        bpy.ops.object.select_all(action='SELECT')
    else:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
    options = {
        'filepath': str(path),
        'export_format': 'GLB',
        'use_selection': True,
        'export_apply': apply_modifiers_on_export,
        'export_yup': True,
        'export_normals': True,
        'export_vertex_color': 'MATERIAL',
        'export_all_vertex_colors': False,
        'export_texcoords': texcoords,
        'export_image_format': 'AUTO',
        'export_materials': 'EXPORT',
        'export_shared_accessors': True,
        'export_hierarchy_flatten_objs': False,
        'export_cameras': False,
        'export_lights': False,
        'export_animations': False,
        'export_skins': False,
        'export_morph': False,
        'export_extras': False
    }
    if compress:
        options['export_meshopt_compression_enable'] = True
        options['export_meshopt_extension'] = 'EXT_meshopt_compression'
    for obj in bpy.context.selected_objects:
        if obj.type == 'MESH':
            layers = obj.data.uv_layers
            while len(layers) > 1:
                layers.remove(layers[len(layers) - 1])
    swapped = _stub_atlas()
    try:
        bpy.ops.export_scene.gltf(**options)
    finally:
        _restore_atlas(swapped)


def _stub_atlas():
    swapped = []
    stub = bpy.data.images.get('atlas-stub')
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image is not None and node.image.name in ('atlas', 'wood'):
                if stub is None:
                    stub = bpy.data.images.new('atlas-stub', 8, 8)
                    stub.pixels.foreach_set(np.ones(8 * 8 * 4, dtype=np.float32))
                swapped.append((node, node.image))
                node.image = stub
    return swapped


def _restore_atlas(swapped):
    for node, image in swapped:
        node.image = image


def render_preview(path, look_at=(0.0, 0.0, 0.0), distance=2.3, height=1.65, fov=34.0, samples=96, width=1600, height_px=1000, yaw=0.35):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    use_gpu()
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height_px
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.filepath = path

    world = scene.world or bpy.data.worlds.new('preview')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = srgb('#0A1216')
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

    target = bpy.data.objects.new('preview-target', None)
    target.location = look_at
    bpy.context.collection.objects.link(target)

    bpy.ops.object.camera_add(location=(look_at[0] + math.sin(yaw) * distance, look_at[1] - math.cos(yaw) * distance, look_at[2] + height))
    camera = bpy.context.active_object
    camera.data.sensor_fit = 'VERTICAL'
    camera.data.sensor_height = 24.0
    camera.data.lens = 12.0 / math.tan(math.radians(fov) / 2)
    track = camera.constraints.new('TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    scene.camera = camera

    def light(kind, location, energy, size, colour_hex, rotation=None):
        bpy.ops.object.light_add(type=kind, location=location)
        lamp = bpy.context.active_object
        lamp.data.energy = energy
        lamp.data.color = srgb(colour_hex)[:3]
        if kind == 'AREA':
            lamp.data.size = size
        if rotation is not None:
            lamp.rotation_euler = rotation
        else:
            aim = lamp.constraints.new('TRACK_TO')
            aim.target = target
            aim.track_axis = 'TRACK_NEGATIVE_Z'
            aim.up_axis = 'UP_Y'
        return lamp

    light('AREA', (look_at[0] + 0.6, look_at[1] - 0.5, look_at[2] + 2.2), 240.0, 1.4, '#FFC46A')
    light('AREA', (look_at[0] - 2.2, look_at[1] - 1.2, look_at[2] + 1.2), 60.0, 3.0, '#2B4E5E')
    light('AREA', (look_at[0] + 0.4, look_at[1] + 2.6, look_at[2] + 1.6), 90.0, 2.5, '#7FB4C9')

    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = -0.3
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.render.render(write_still=True)

    for obj in (camera, target):
        bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [o for o in bpy.data.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(obj, do_unlink=True)


def ellipse_path(a, b, segments=56, phase=0.0):
    return [(math.cos(t) * a, math.sin(t) * b) for t in (phase + index / segments * math.tau for index in range(segments))]


def polygon_path(sides, radius, phase=0.0):
    return [(math.cos(t) * radius, math.sin(t) * radius) for t in (phase + index / sides * math.tau for index in range(sides))]


def square_path(half, corner=0.0, corner_segments=4):
    if corner <= 0.0:
        return [(half, -half), (half, half), (-half, half), (-half, -half)]
    out = []
    for cx, cy, start in ((half - corner, -(half - corner), -math.pi / 2), (half - corner, half - corner, 0.0), (-(half - corner), half - corner, math.pi / 2), (-(half - corner), -(half - corner), math.pi)):
        for step in range(corner_segments + 1):
            t = start + (math.pi / 2) * step / corner_segments
            out.append((cx + math.cos(t) * corner, cy + math.sin(t) * corner))
    return out


def sweep(name, profile, path, close_profile=True, location=(0, 0, 0)):
    count = len(path)
    normals = []
    for index in range(count):
        px, py = path[index]
        nx0, ny0 = path[index - 1]
        nx1, ny1 = path[(index + 1) % count]
        e0 = Vector((px - nx0, py - ny0)).normalized()
        e1 = Vector((nx1 - px, ny1 - py)).normalized()
        n0 = Vector((e0.y, -e0.x))
        n1 = Vector((e1.y, -e1.x))
        bisector = n0 + n1
        scale = 1.0 + n0.dot(n1)
        normals.append(bisector / scale if scale > 1e-6 else n0)
    bm = bmesh.new()
    rings = []
    for index in range(count):
        px, py = path[index]
        nx, ny = normals[index]
        rings.append([bm.verts.new((px + nx * d, py + ny * d, z)) for d, z in profile])
    steps = len(profile)
    for index in range(count):
        ring_a = rings[index]
        ring_b = rings[(index + 1) % count]
        for step in range(steps - 1):
            bm.faces.new((ring_a[step], ring_b[step], ring_b[step + 1], ring_a[step + 1]))
        if close_profile and steps > 2:
            bm.faces.new((ring_a[steps - 1], ring_b[steps - 1], ring_b[0], ring_a[0]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, location)


def slab_path(name, path, z0, z1, location=(0, 0, 0)):
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in path]
    top = [bm.verts.new((x, y, z1)) for x, y in path]
    bm.faces.new(bottom[::-1])
    bm.faces.new(top)
    count = len(path)
    for index in range(count):
        nxt = (index + 1) % count
        bm.faces.new((bottom[index], bottom[nxt], top[nxt], top[index]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, location)


def uv_box(obj, scale=2.0, rotate=0.0, offset=(0.0, 0.0)):
    cos_r = math.cos(rotate)
    sin_r = math.sin(rotate)

    def mapper(face, co):
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        if az >= ax and az >= ay:
            s, t = co.x, co.y
        elif ax >= ay:
            s, t = co.y, co.z
        else:
            s, t = co.x, co.z
        u = (s * cos_r - t * sin_r) * scale + offset[0]
        v = (s * sin_r + t * cos_r) * scale + offset[1]
        return (u, v)

    uv_map(obj, mapper)


def delete_faces(obj, predicate):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    doomed = [face for face in bm.faces if predicate(face.calc_center_median(), face.normal)]
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()


def solidify(obj, thickness, offset=1.0):
    mod = obj.modifiers.new('Solidify', 'SOLIDIFY')
    mod.thickness = thickness
    mod.offset = offset
    mod.use_even_offset = True
    mod.use_rim = True
    apply_modifiers(obj)


def subsurf(obj, levels=2):
    mod = obj.modifiers.new('Subdivision', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    apply_modifiers(obj)


def transform(obj, matrix):
    mesh = obj.data
    mesh.transform(matrix)
    mesh.update()


def bounds(obj):
    coords = np.array([vertex.co for vertex in obj.data.vertices])
    return coords.min(axis=0), coords.max(axis=0)
