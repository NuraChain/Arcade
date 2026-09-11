import math

from mathutils import Matrix

from lib import kit


def rim(name, path, top, width, lip=0.004, depth=0.062, nose=0.012):
    profile = [
        (0.0, top - depth),
        (nose * 0.7, top - depth + 0.006),
        (nose, top - depth * 0.55),
        (nose * 0.85, top - 0.010),
        (nose * 0.35, top + lip - 0.002),
        (0.0, top + lip),
        (-width * 0.3, top + lip),
        (-width + 0.006, top + lip),
        (-width, top + lip - 0.003),
        (-width, top - depth)
    ]
    obj = kit.sweep(name, profile, path, close_profile=True)
    kit.paint(obj, 'walnut')
    kit.smooth(obj, 32.0)
    return obj


def inlay(name, path, top, inset, width=0.005, proud=0.0008):
    profile = [
        (-inset, top - 0.002),
        (-inset, top + proud),
        (-inset - width, top + proud),
        (-inset - width, top - 0.002)
    ]
    obj = kit.sweep(name, profile, path, close_profile=True)
    kit.paint(obj, 'brass')
    kit.smooth(obj, 60.0)
    return obj


def apron(name, path, top, inset, height=0.055, thickness=0.028, drop=0.0):
    z1 = top - drop
    z0 = z1 - height
    profile = [
        (-inset, z0),
        (-inset, z1),
        (-inset - thickness, z1),
        (-inset - thickness, z0 + 0.004),
        (-inset - thickness + 0.004, z0)
    ]
    obj = kit.sweep(name, profile, path, close_profile=True)
    kit.paint(obj, 'walnut_dark')
    kit.smooth(obj, 40.0)
    return obj


def felt(name, radius, top, sides=64, rings=8, thickness=0.006, phase=0.0):
    profile = [(0.0, top)]
    for step in range(1, rings + 1):
        profile.append((radius * step / rings, top))
    profile.append((radius, top - thickness))
    profile.append((0.0, top - thickness))
    obj = kit.lathe(name, profile, sides=sides)
    if phase:
        kit.transform(obj, Matrix.Rotation(phase, 4, 'Z'))
    kit.paint(obj, 'felt')
    kit.smooth(obj, 30.0)
    return obj


def underside(name, radius, z0, z1, sides=64, phase=0.0):
    obj = kit.lathe(name, [(0.0, z0), (radius, z0), (radius, z1), (0.0, z1)], sides=sides)
    if phase:
        kit.transform(obj, Matrix.Rotation(phase, 4, 'Z'))
    kit.paint(obj, 'walnut_dark')
    kit.smooth(obj, 30.0)
    return obj


def pedestal(name, height, plinth=0.46, shaft=0.12, sides=48, location=(0, 0, 0)):
    profile = [
        (0.0, 0.0),
        (plinth, 0.0),
        (plinth, 0.032),
        (plinth - 0.03, 0.05),
        (plinth * 0.72, 0.075),
        (plinth * 0.45, 0.115),
        (shaft * 1.5, 0.15),
        (shaft * 1.12, 0.20),
        (shaft, 0.28),
        (shaft * 0.94, height * 0.55),
        (shaft, height - 0.16),
        (shaft * 1.15, height - 0.10),
        (shaft * 1.7, height - 0.055),
        (shaft * 2.0, height - 0.03),
        (shaft * 2.0, height),
        (0.0, height)
    ]
    obj = kit.lathe(name, profile, sides=sides, location=location)
    kit.paint(obj, 'walnut_dark')
    kit.smooth(obj, 32.0)
    return obj


def collar(name, radius, z, minor=0.010, sides=48):
    obj = kit.torus(name, major=radius, minor=minor, major_segments=sides, minor_segments=10, location=(0, 0, z))
    kit.paint(obj, 'brass')
    kit.smooth(obj, 60.0)
    return obj


def turned_leg(name, height, top_block=0.07, block_height=0.14, location=(0, 0, 0)):
    shaft_top = height - block_height
    profile = [
        (0.0, 0.0),
        (0.022, 0.0),
        (0.026, 0.012),
        (0.022, 0.03),
        (0.02, 0.06),
        (0.026, 0.13),
        (0.032, 0.15),
        (0.028, 0.165),
        (0.028, 0.30),
        (0.033, shaft_top - 0.05),
        (0.036, shaft_top - 0.02),
        (0.03, shaft_top - 0.012),
        (0.03, shaft_top),
        (0.0, shaft_top)
    ]
    shaft = kit.lathe(name, profile, sides=28, location=location)
    kit.paint(shaft, 'walnut_dark')
    kit.smooth(shaft, 36.0)
    block = kit.box(name + '-block', size=(top_block, top_block, block_height), location=(location[0], location[1], location[2] + shaft_top + block_height / 2), bevel_width=0)
    kit.paint(block, 'walnut_dark')
    kit.finish(block, 0.004, segments=3, angle=35.0)
    return kit.join([shaft, block], name)


def ferrule(name, radius=0.026, height=0.018, location=(0, 0, 0)):
    obj = kit.lathe(name, [(0.0, 0.0), (radius, 0.0), (radius, height - 0.003), (radius - 0.003, height), (0.0, height)], sides=24, location=location)
    kit.paint(obj, 'brass')
    kit.smooth(obj, 40.0)
    return obj


def stretcher(name, start, end, radius=0.017):
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dz = end[2] - start[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    centre = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2)
    yaw = math.atan2(dy, dx)
    pitch = math.atan2(dz, math.hypot(dx, dy))
    obj = kit.cylinder(name, radius=radius, depth=length, sides=18, location=centre, rotation=(0, math.pi / 2 - pitch, yaw), bevel_width=0)
    kit.paint(obj, 'walnut_dark')
    kit.smooth(obj, 40.0)
    return obj


def corner_cap(name, x, y, top, size=0.048, thickness=0.0022, angle=0.0):
    plate = kit.box(name, size=(size, size, thickness), location=(x, y, top + thickness / 2), rotation=(0, 0, angle), bevel_width=0)
    kit.paint(plate, 'brass')
    kit.finish(plate, 0.0008, segments=2, angle=35.0)
    return plate
