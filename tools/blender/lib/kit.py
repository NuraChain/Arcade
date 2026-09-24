import bpy
import bmesh
import json
import math
import os
import re
import urllib.request
from mathutils import Vector

import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SCRATCH = os.path.join(HERE, 'scratch')
TEXTURES = os.path.join(SCRATCH, 'textures')
ART = os.path.join(SCRATCH, 'art')
TOKENS = os.path.join(ROOT, 'application', 'src', 'styles', 'tokens.css')
STUDIO = os.path.join(ROOT, 'application', 'src', 'world', 'render', 'studio.json')


def output_dir():
    base = os.environ.get('NURA_OUT')
    if base is None:
        base = os.path.join(ROOT, 'application', 'public', 'world')
    os.makedirs(base, exist_ok=True)
    return os.path.abspath(base)


def output_path(name):
    return os.path.join(output_dir(), name + '.glb')


def srgb(hex_colour, alpha=1.0):
    value = hex_colour.lstrip('#')
    out = []
    for index in (0, 2, 4):
        channel = int(value[index:index + 2], 16) / 255.0
        out.append(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], alpha)


_tokens = None


def token(name):
    global _tokens
    if _tokens is None:
        with open(TOKENS, encoding='utf-8') as handle:
            _tokens = dict(re.findall(r'--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})', handle.read()))
    return _tokens[name]


def studio():
    with open(STUDIO, encoding='utf-8') as handle:
        return json.load(handle)


def texture(asset, kind, resolution='2k'):
    os.makedirs(TEXTURES, exist_ok=True)
    path = os.path.join(TEXTURES, f'{asset}_{kind}_{resolution}.jpg')
    if os.path.exists(path):
        return path
    request = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers={'User-Agent': 'nura-games-build'})
    files = json.loads(urllib.request.urlopen(request).read())
    url = files[kind][resolution]['jpg']['url']
    download = urllib.request.Request(url, headers={'User-Agent': 'nura-games-build'})
    with urllib.request.urlopen(download) as response, open(path, 'wb') as target:
        target.write(response.read())
    return path


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def image(path, colour=True):
    name = os.path.basename(path)
    existing = bpy.data.images.get(name)
    if existing is not None:
        return existing
    loaded = bpy.data.images.load(path)
    loaded.name = name
    loaded.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return loaded


def _node(tree, kind):
    return next(node for node in tree.nodes if node.type == kind)


def _image_node(tree, picture, uv_scale=None):
    node = tree.nodes.new('ShaderNodeTexImage')
    node.image = picture
    node.interpolation = 'Linear'
    if uv_scale is not None:
        mapping = tree.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (uv_scale, uv_scale, 1.0)
        coords = tree.nodes.new('ShaderNodeTexCoord')
        tree.links.new(coords.outputs['UV'], mapping.inputs['Vector'])
        tree.links.new(mapping.outputs['Vector'], node.inputs['Vector'])
    return node


def material(name, base='#FFFFFF', roughness=0.5, metallic=0.0, coat=0.0, coat_roughness=0.08, sheen=0.0,
             sheen_roughness=0.5, sheen_tint='#FFFFFF', base_image=None, normal_image=None, normal_strength=1.0,
             roughness_image=None, uv_scale=None, alpha=False):
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = _node(tree, 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = srgb(base)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Coat Weight'].default_value = coat
    bsdf.inputs['Coat Roughness'].default_value = coat_roughness
    bsdf.inputs['Sheen Weight'].default_value = sheen
    bsdf.inputs['Sheen Roughness'].default_value = sheen_roughness
    bsdf.inputs['Sheen Tint'].default_value = srgb(sheen_tint)
    if base_image is not None:
        node = _image_node(tree, image(base_image), uv_scale)
        tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha:
            tree.links.new(node.outputs['Alpha'], bsdf.inputs['Alpha'])
    if roughness_image is not None:
        node = _image_node(tree, image(roughness_image, colour=False), uv_scale)
        tree.links.new(node.outputs['Color'], bsdf.inputs['Roughness'])
    if normal_image is not None:
        node = _image_node(tree, image(normal_image, colour=False), uv_scale)
        normal = tree.nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = normal_strength
        tree.links.new(node.outputs['Color'], normal.inputs['Color'])
        tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def emission(name, colour, strength):
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    for node in list(tree.nodes):
        if node.type != 'OUTPUT_MATERIAL':
            tree.nodes.remove(node)
    emit = tree.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = srgb(colour)
    emit.inputs['Strength'].default_value = strength
    tree.links.new(emit.outputs['Emission'], _node(tree, 'OUTPUT_MATERIAL').inputs['Surface'])
    return mat


def assign(obj, *materials):
    obj.data.materials.clear()
    for mat in materials:
        obj.data.materials.append(mat)


def slot(obj, index, predicate):
    for poly in obj.data.polygons:
        if predicate(poly.center, poly.normal):
            poly.material_index = index


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


def export(path, objects, quality=86):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_vertex_color='NONE',
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=quality,
        export_shared_accessors=True,
        export_hierarchy_flatten_objs=False,
        export_gpu_instances=True,
        export_cameras=False,
        export_lights=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_skins=False,
        export_morph=False,
        export_extras=False,
        export_meshopt_compression_enable=True
    )


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


def rect_path(half_x, half_y, corner, corner_segments=8):
    out = []
    for cx, cy, start in ((half_x - corner, -(half_y - corner), -math.pi / 2), (half_x - corner, half_y - corner, 0.0), (-(half_x - corner), half_y - corner, math.pi / 2), (-(half_x - corner), -(half_y - corner), math.pi)):
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
