import json
import struct

import bpy

FPS = 30

END = 240


def _curves(obj):
    action = obj.animation_data.action
    try:
        from bpy_extras import anim_utils
        bag = anim_utils.action_get_channelbag_for_slot(action, obj.animation_data.action_slot)
        if bag is not None:
            return list(bag.fcurves)
    except (ImportError, AttributeError):
        pass
    return list(action.fcurves)


def keyframes(obj, name, keys, easing):
    if obj.data is not None and obj.data.users > 1:
        obj.data = obj.data.copy()
    rest_location = obj.location.copy()
    rest_rotation = obj.rotation_euler.copy()
    for frame, offset, turn in keys:
        obj.location = (rest_location.x + offset[0], rest_location.y + offset[1], rest_location.z + offset[2])
        obj.rotation_euler = (rest_rotation.x + turn[0], rest_rotation.y + turn[1], rest_rotation.z + turn[2])
        obj.keyframe_insert('location', frame=frame)
        obj.keyframe_insert('rotation_euler', frame=frame)
    obj.location = rest_location
    obj.rotation_euler = rest_rotation
    for curve in _curves(obj):
        for index, point in enumerate(curve.keyframe_points):
            point.interpolation = 'QUAD'
            point.easing = easing[min(index, len(easing) - 1)]
    obj.animation_data.action.name = name
    obj['settle'] = name
    return keys[-1][0]


def drop(obj, name, height, spin, start=1, fall=12, bounce=0.01, drift=(0.0, 0.0)):
    land = start + fall
    obj['settle_land'] = land
    return keyframes(obj, name, [
        (start, (drift[0], drift[1], height), spin),
        (land, (0.0, 0.0, 0.0), (0.0, 0.0, spin[2] * 0.2)),
        (land + 4, (0.0, 0.0, bounce), (spin[0] * 0.03, spin[1] * 0.03, spin[2] * 0.06)),
        (land + 8, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    ], ['EASE_IN', 'EASE_OUT', 'EASE_IN', 'EASE_IN'])


def appear(obj, name, land, lead=3):
    obj.scale = (0.001, 0.001, 0.001)
    obj.keyframe_insert('scale', frame=max(land - lead, 1))
    obj.scale = (1.0, 1.0, 1.0)
    obj.keyframe_insert('scale', frame=land)
    for curve in _curves(obj):
        for point in curve.keyframe_points:
            point.interpolation = 'LINEAR'
    obj.animation_data.action.name = name
    obj['settle'] = name


def resting_on(obj, surface_z, tolerance=0.002):
    lowest = min((obj.matrix_world @ vertex.co).z for vertex in obj.data.vertices)
    return abs(lowest - surface_z) <= tolerance


def prepare():
    bpy.context.scene.render.fps = FPS


def rest():
    bpy.context.scene.frame_set(END)


def retarget(path):
    owners = {obj['settle']: obj.name for obj in bpy.data.objects if obj.get('settle') is not None}
    with open(path, 'rb') as handle:
        data = handle.read()
    magic, version, _ = struct.unpack_from('<III', data, 0)
    length, kind = struct.unpack_from('<II', data, 12)
    document = json.loads(data[20:20 + length].decode('utf-8'))
    rest_of_file = data[20 + length:]
    index = {node.get('name'): number for number, node in enumerate(document.get('nodes', []))}
    for animation in document.get('animations', []):
        owner = owners.get(animation.get('name'))
        if owner is None or owner not in index:
            raise RuntimeError('no node carries the animation %s' % animation.get('name'))
        for channel in animation['channels']:
            channel['target']['node'] = index[owner]
    missing = sorted(set(owners) - {animation.get('name') for animation in document.get('animations', [])})
    if missing:
        raise RuntimeError('animations were not exported: %s' % ', '.join(missing))
    encoded = json.dumps(document, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * ((4 - len(encoded) % 4) % 4)
    total = 12 + 8 + len(encoded) + len(rest_of_file)
    with open(path, 'wb') as handle:
        handle.write(struct.pack('<III', magic, version, total) + struct.pack('<II', len(encoded), kind) + encoded + rest_of_file)
