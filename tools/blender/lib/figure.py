import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from lib import kit

VISIBLE = 0.575
HIP = Vector((0.0, 0.0, 0.09))
NECK_PIVOT = Vector((0.0, 0.035, 0.64))


class Pose:
    def __init__(self, lean_angle=0.16, head_nod=0.22, head_turn=0.0, arms=None):
        self.lean_angle = lean_angle
        self.head_nod = head_nod
        self.head_turn = head_turn
        self.arms = arms or {'left': 'table', 'right': 'table'}


ARM_POSES = {
    'table': {'elbow': (0.26, 0.15, 0.31), 'wrist': (0.20, 0.40, 0.315), 'normal': (0, 0, 1)},
    'chin': {'elbow': (0.23, 0.36, 0.31), 'wrist': (0.13, 0.27, 0.56), 'normal': (0.9, 0.3, 0.3)},
    'thigh': {'elbow': (0.27, 0.10, 0.27), 'wrist': (0.20, 0.31, 0.13), 'normal': (0, 0, 1)},
    'lap': {'elbow': (0.25, 0.12, 0.26), 'wrist': (0.11, 0.30, 0.15), 'normal': (0, 0, 1)}
}


def _rotation_to(direction):
    d = Vector(direction).normalized()
    return Vector((1.0, 0.0, 0.0)).rotation_difference(d)


def _frame(forward, normal):
    f = Vector(forward).normalized()
    n = Vector(normal)
    n = (n - f * n.dot(f)).normalized()
    s = n.cross(f).normalized()
    return Matrix((f, s, n)).transposed().to_quaternion()


class Meta:
    def __init__(self, name, resolution=0.007):
        self.data = bpy.data.metaballs.new(name + 'Meta')
        self.data.resolution = resolution
        self.data.render_resolution = resolution
        self.data.threshold = 0.6
        self.object = bpy.data.objects.new(name + 'Meta', self.data)
        bpy.context.collection.objects.link(self.object)
        self.name = name

    def ball(self, centre, radius, stiffness=2.0, negative=False):
        element = self.data.elements.new()
        element.type = 'BALL'
        element.co = Vector(centre)
        element.radius = radius / VISIBLE
        element.stiffness = stiffness
        element.use_negative = negative
        return element

    def ellipsoid(self, centre, semi, rotation=None, stiffness=2.0, negative=False):
        element = self.data.elements.new()
        element.type = 'ELLIPSOID'
        element.co = Vector(centre)
        element.radius = 1.0 / VISIBLE
        element.size_x, element.size_y, element.size_z = semi
        element.stiffness = stiffness
        element.use_negative = negative
        if rotation is not None:
            element.rotation = rotation
        return element

    def capsule(self, start, end, radius, stiffness=2.0, negative=False):
        a = Vector(start)
        b = Vector(end)
        direction = b - a
        length = direction.length
        element = self.data.elements.new()
        element.type = 'CAPSULE'
        element.co = (a + b) / 2
        element.radius = radius / VISIBLE
        element.size_x = max(length / 2 - radius * 0.35, 0.001)
        element.rotation = _rotation_to(direction)
        element.stiffness = stiffness
        element.use_negative = negative
        return element

    def cube(self, centre, semi, rotation=None, stiffness=2.0, negative=False):
        element = self.data.elements.new()
        element.type = 'CUBE'
        element.co = Vector(centre)
        element.radius = 0.02 / VISIBLE
        element.size_x, element.size_y, element.size_z = semi
        element.stiffness = stiffness
        element.use_negative = negative
        if rotation is not None:
            element.rotation = rotation
        return element

    def to_mesh(self, voxel=0.007, target=4000, smooth_iterations=3):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = self.object.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        bpy.data.objects.remove(self.object, do_unlink=True)
        bpy.data.metaballs.remove(self.data)
        remesh = obj.modifiers.new('Remesh', 'REMESH')
        remesh.mode = 'VOXEL'
        remesh.voxel_size = voxel
        remesh.use_smooth_shade = True
        smooth = obj.modifiers.new('Smooth', 'SMOOTH')
        smooth.factor = 0.5
        smooth.iterations = smooth_iterations
        kit.apply_modifiers(obj)
        faces = len(obj.data.polygons)
        if faces > target:
            decimate = obj.modifiers.new('Decimate', 'DECIMATE')
            decimate.ratio = target / faces
            decimate.use_collapse_triangulate = True
            kit.apply_modifiers(obj)
        kit.smooth(obj, 70.0)
        return obj


def lean_matrix(angle):
    return Matrix.Translation(HIP) @ Matrix.Rotation(-angle, 4, 'X') @ Matrix.Translation(-HIP)


def head_matrix(pose):
    nod = Matrix.Translation(NECK_PIVOT) @ Matrix.Rotation(pose.head_turn, 4, 'Z') @ Matrix.Rotation(pose.head_nod, 4, 'X') @ Matrix.Translation(-NECK_PIVOT)
    return lean_matrix(pose.lean_angle) @ nod


def _apply(matrix, elements):
    for element in elements:
        element.co = matrix @ Vector(element.co)
        element.rotation = (matrix.to_quaternion() @ Quaternion(element.rotation)).normalized()


def build(pose, shirt='white', trousers='charcoal', skin='skin_medium', hair='hair_black', hair_style='crop', budget=(2600, 1900, 2600, 800)):
    body = lean_matrix(pose.lean_angle)
    head = head_matrix(pose)

    shirt_meta = Meta('Shirt', resolution=0.008)
    torso = [
        shirt_meta.ellipsoid((0.0, 0.005, 0.20), (0.15, 0.105, 0.12)),
        shirt_meta.ellipsoid((0.0, 0.015, 0.31), (0.152, 0.105, 0.11)),
        shirt_meta.ellipsoid((0.0, 0.02, 0.42), (0.168, 0.115, 0.12)),
        shirt_meta.ellipsoid((0.0, 0.025, 0.49), (0.16, 0.105, 0.075)),
        shirt_meta.ball((-0.175, 0.03, 0.505), 0.066),
        shirt_meta.ball((0.175, 0.03, 0.505), 0.066),
        shirt_meta.ellipsoid((0.0, 0.03, 0.55), (0.095, 0.082, 0.042))
    ]
    _apply(body, torso)

    hands = []
    for side, sign in (('left', -1), ('right', 1)):
        arm = ARM_POSES[pose.arms[side]]
        shoulder = body @ Vector((sign * 0.19, 0.03, 0.50))
        elbow = Vector((sign * arm['elbow'][0], arm['elbow'][1], arm['elbow'][2]))
        wrist = Vector((sign * arm['wrist'][0], arm['wrist'][1], arm['wrist'][2]))
        shirt_meta.capsule(shoulder, elbow, 0.047)
        shirt_meta.ball(elbow, 0.046)
        shirt_meta.capsule(elbow, wrist, 0.040)
        shirt_meta.ball(wrist - (wrist - elbow).normalized() * 0.012, 0.042)
        normal = Vector(arm['normal'])
        normal.x *= sign
        hands.append((wrist, (wrist - elbow).normalized(), normal, sign))

    trousers_meta = Meta('Trousers', resolution=0.008)
    trousers_meta.ellipsoid((0.0, 0.0, 0.07), (0.17, 0.125, 0.095))
    trousers_meta.ellipsoid((0.0, 0.005, 0.14), (0.15, 0.11, 0.06))
    for sign in (-1, 1):
        hip = Vector((sign * 0.095, 0.03, 0.05))
        knee = Vector((sign * 0.115, 0.44, 0.06))
        ankle = Vector((sign * 0.12, 0.47, -0.36))
        trousers_meta.capsule(hip, knee, 0.074)
        trousers_meta.ball(knee, 0.062)
        trousers_meta.capsule(knee, ankle, 0.058)
        trousers_meta.ball(ankle, 0.046)
        trousers_meta.ellipsoid((sign * 0.12, 0.545, -0.43), (0.046, 0.125, 0.034))

    skin_meta = Meta('Skin', resolution=0.006)
    neck = [skin_meta.capsule((0.0, 0.03, 0.53), (0.0, 0.04, 0.66), 0.056)]
    _apply(body, neck)
    head_parts = [
        skin_meta.ellipsoid((0.0, 0.045, 0.745), (0.079, 0.092, 0.107)),
        skin_meta.ellipsoid((0.0, 0.06, 0.69), (0.062, 0.075, 0.052)),
        skin_meta.ball((0.0, 0.138, 0.715), 0.013),
        skin_meta.ellipsoid((-0.083, 0.03, 0.725), (0.008, 0.017, 0.022)),
        skin_meta.ellipsoid((0.083, 0.03, 0.725), (0.008, 0.017, 0.022))
    ]
    _apply(head, head_parts)
    for wrist, forward, normal, sign in hands:
        frame = _frame(forward, normal)
        side = Vector(normal).cross(forward).normalized()
        palm = wrist + forward * 0.052
        skin_meta.ellipsoid(palm, (0.048, 0.044, 0.016), rotation=frame)
        for index, spread in enumerate((-0.030, -0.010, 0.010, 0.030)):
            base = palm + forward * 0.03 + side * spread
            length = (0.070, 0.084, 0.080, 0.064)[index]
            tip = base + forward * length + side * spread * 0.25 - Vector(normal).normalized() * 0.006
            skin_meta.capsule(base, tip, 0.0095)
        thumb_base = palm - side * sign * 0.04 - forward * 0.01
        thumb_tip = thumb_base + forward * 0.04 - side * sign * 0.03
        skin_meta.capsule(thumb_base, thumb_tip, 0.011)

    hair_meta = Meta('Hair', resolution=0.006)
    hair_parts = [hair_meta.ellipsoid((0.0, 0.035, 0.752), (0.094, 0.107, 0.12))]
    hair_parts.append(hair_meta.ellipsoid((0.0, 0.15, 0.685), (0.115, 0.075, 0.095), negative=True, stiffness=3.0))
    if hair_style == 'bob':
        hair_parts.append(hair_meta.cube((0.0, 0.03, 0.47), (0.3, 0.3, 0.18), negative=True, stiffness=8.0))
        hair_parts.append(hair_meta.ellipsoid((0.0, 0.11, 0.655), (0.07, 0.10, 0.06), negative=True, stiffness=8.0))
        hair_parts.append(hair_meta.ellipsoid((0.0, 0.02, 0.69), (0.098, 0.108, 0.07)))
    else:
        hair_parts.append(hair_meta.cube((0.0, 0.03, 0.515), (0.3, 0.3, 0.18), negative=True, stiffness=8.0))
    if hair_style == 'bun':
        hair_parts.append(hair_meta.ball((0.0, -0.082, 0.75), 0.036))
    _apply(head, hair_parts)

    shirt_obj = shirt_meta.to_mesh(voxel=0.008, target=budget[0])
    trousers_obj = trousers_meta.to_mesh(voxel=0.008, target=budget[1])
    skin_obj = skin_meta.to_mesh(voxel=0.006, target=budget[2], smooth_iterations=2)
    hair_obj = hair_meta.to_mesh(voxel=0.006, target=budget[3])

    kit.paint(shirt_obj, shirt)
    kit.assign(shirt_obj, 'cloth')
    kit.paint(trousers_obj, trousers)
    kit.paint(trousers_obj, 'ebony', faces=lambda c, n: c.z < -0.385)
    kit.assign(trousers_obj, 'cloth')
    kit.paint(skin_obj, skin)
    kit.assign(skin_obj, 'skin')
    kit.paint(hair_obj, hair)
    kit.assign(hair_obj, 'hair')

    return [shirt_obj, trousers_obj, skin_obj, hair_obj]
