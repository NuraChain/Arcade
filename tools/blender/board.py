"""
The playable board, rendered from the object the market scene already stands on.

Run by hand, like `art.py`, because it needs Blender:

    blender -b -P tools/blender/board.py

One thing is rendered, and it is BAKED - it never changes with state or theme, which is the same
line the GLB kit draws: walnut and printed card are real materials and look like themselves in any
light.

  public/board/ludo-plate-1024.webp   the board seen from directly above

The TOKENS are deliberately not rendered here. Seen from straight above a ludo token is a coloured
disc with a highlight and a contact shadow, and CSS draws that crisply at every size, in the exact
palette, tinted per player, with no second request and no blurring when the board is 288px wide on
a phone and 704px on a monitor. A baked sprite would be a fixed resolution fighting a fluid board.

The plate is rendered from `application/public/world/set-ludo.glb` rather than drawn again. That is
the point: the 2D board a player moves tokens on and the 3D board standing in the night market are
then the same object, photographed, instead of two descriptions that agree until somebody edits one.
An orthographic camera straight down means the render maps cell-for-cell onto the 15x15 grid the
rules use, so the client positions a token by grid coordinate and nothing has to be measured.

Where the grid sits in the image, for whoever positions things over it. The camera frames the
board's outer edge exactly, the paper begins 4.21% in from each side, and the print carries its own
cream margin inside that, so the first CELL begins at 5.69% and each cell is 5.91% of the plate.
Those numbers are geometry (`RIM`, `BOARD` and the atlas margin in `set-ludo.py` and `atlas.py`), not
something this file chooses, and they move only if that geometry does.

The GLB is the market's object, so two things about it are corrected before the camera sees it. Its
AO was baked with the pawns and dice standing on the field, and their contact shadows are in the
face's vertex colours - which is right for the scene they stand in and wrong for an empty board, so
the face is repainted the flat card white it was painted before the bake. And export swaps every
image for an 8x8 stub so the GLB embeds nothing, which means the imported materials render blank;
they are rebuilt here from the real atlas and the real walnut pair, as this scene's own materials
rather than a run-time remap, because a photograph of a board is allowed to know it is walnut and
card.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np

from lib import kit

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORLD = os.path.join(ROOT, 'application', 'public', 'world')
OUT = os.path.join(ROOT, 'application', 'public', 'board')
TMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')

PLATE = 1024
SAMPLES = 512
GRAIN_SCALE = 16.0


def clear():
    kit.reset_scene()
    for block in list(bpy.data.objects):
        bpy.data.objects.remove(block, do_unlink=True)


def cycles(samples, look='Standard', exposure=0.0):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    kit.use_gpu()
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.005
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.cycles.denoising_prefilter = 'ACCURATE'
    scene.cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    scene.render.film_transparent = True
    scene.render.filter_size = 1.25
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'

    # `Standard` rather than the `AgX` the hero art uses. AgX exists to roll off bright highlights on
    # a lamplit scene and it desaturates hard doing it - the first plate came out pastel, with the
    # four strong colours of `kit.py` reading as pink and mint. A flat top-down board has no
    # highlights to save and its colours are the product's own, so they are rendered as they are,
    # and the lamps are kept below the point where card white would clip.
    scene.view_settings.view_transform = look
    scene.view_settings.exposure = exposure
    world = scene.world or bpy.data.worlds.new('board')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = kit.srgb('#4C4640')
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.2


def aim(obj, at):
    target = bpy.data.objects.new('aim', None)
    target.location = at
    bpy.context.collection.objects.link(target)
    track = obj.constraints.new('TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'


def lamp(location, energy, size, colour):
    bpy.ops.object.light_add(type='AREA', location=location)
    light = bpy.context.active_object
    light.data.energy = energy
    light.data.size = size
    light.data.color = kit.srgb(colour)[:3]
    aim(light, (0.0, 0.0, 0.0))
    return light


def overhead(extent, width):
    bpy.ops.object.camera_add(location=(0.0, 0.0, 1.2))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = extent
    cam.rotation_euler = (0.0, 0.0, 0.0)

    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x = width
    scene.render.resolution_y = width
    scene.render.resolution_percentage = 100


def write(name):
    png = os.path.join(TMP, name + '.png')
    os.makedirs(TMP, exist_ok=True)
    scene = bpy.context.scene
    scene.render.filepath = png
    bpy.ops.render.render(write_still=True)

    # The webp is saved from the render result rather than by reloading the png, so the view
    # transform is applied exactly once. Loading the png back and saving it through the scene's
    # settings applies whatever transform the scene holds a second time, which is invisible under
    # `Standard` and wrong under anything else.
    settings = scene.render.image_settings
    settings.file_format = 'WEBP'
    settings.quality = 92
    settings.color_mode = 'RGBA'
    os.makedirs(OUT, exist_ok=True)
    target = os.path.join(OUT, name + '.webp')
    bpy.data.images['Render Result'].save_render(target, scene=scene)

    print('board: wrote %s (%d bytes)' % (target, os.path.getsize(target)))


def image(name, colourspace='sRGB'):
    loaded = bpy.data.images.load(os.path.join(WORLD, name))
    loaded.colorspace_settings.name = colourspace
    return loaded


def principled(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    bsdf = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')
    return material, tree, bsdf


def multiply(tree, a, b):
    mix = tree.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    colours = [socket for socket in mix.inputs if socket.type == 'RGBA']
    tree.links.new(a, colours[0])
    tree.links.new(b, colours[1])
    return mix.outputs[2]


def vertex_colour(tree):
    node = tree.nodes.new('ShaderNodeVertexColor')
    node.layer_name = 'Color'
    return node.outputs['Color']


def walnut(board):
    # The grain runs the length of each rail: the side rails are full-height strips and the top
    # and bottom rails are fitted between them, which is how `set-ludo.py` cuts them, and the grain
    # has to agree with the joint or the frame reads as one printed sheet. The walnut texture's
    # rings run along v, so a rail lying along x is mapped with x on v and a rail lying along y
    # with y on v, and each face picks its rail from which axis its centre is further out on.
    def grain(face, co):
        centre = face.calc_center_median()
        if abs(centre.y) > abs(centre.x):
            return (co.y * GRAIN_SCALE, co.x * GRAIN_SCALE)
        return (co.x * GRAIN_SCALE, co.y * GRAIN_SCALE)

    kit.uv_map(board, grain)

    material, tree, bsdf = principled('walnut')
    colour = tree.nodes.new('ShaderNodeTexImage')
    colour.image = image('wood-512.webp')
    colour.interpolation = 'Cubic'
    relief = tree.nodes.new('ShaderNodeTexImage')
    relief.image = image('wood-normal-512.webp', 'Non-Color')
    relief.interpolation = 'Cubic'

    tree.links.new(multiply(tree, colour.outputs['Color'], vertex_colour(tree)), bsdf.inputs['Base Color'])

    # Open pores are rougher than the figure between them, so the sheen breaks along the grain
    # instead of lying on the rail like a sheet of glass.
    figure = tree.nodes.new('ShaderNodeRGBToBW')
    tree.links.new(colour.outputs['Color'], figure.inputs['Color'])
    pores = tree.nodes.new('ShaderNodeMapRange')
    pores.inputs['From Min'].default_value = 0.40
    pores.inputs['From Max'].default_value = 0.95
    pores.inputs['To Min'].default_value = 0.46
    pores.inputs['To Max'].default_value = 0.26
    tree.links.new(figure.outputs['Val'], pores.inputs['Value'])
    tree.links.new(pores.outputs['Result'], bsdf.inputs['Roughness'])

    normal = tree.nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = 0.55
    tree.links.new(relief.outputs['Color'], normal.inputs['Color'])
    tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])

    bsdf.inputs['Coat Weight'].default_value = 0.18
    bsdf.inputs['Coat Roughness'].default_value = 0.14

    board.data.materials.clear()
    board.data.materials.append(material)


def paper(field):
    layer = field.data.color_attributes['Color']
    flat = np.tile(np.array(kit.colour('white'), dtype=np.float32), len(layer.data))
    layer.data.foreach_set('color', flat)

    material, tree, bsdf = principled('card')
    print_ = tree.nodes.new('ShaderNodeTexImage')
    print_.image = image('atlas-2048.webp')
    print_.interpolation = 'Cubic'
    tree.links.new(multiply(tree, print_.outputs['Color'], vertex_colour(tree)), bsdf.inputs['Base Color'])

    # Card stock has a tooth, and a printed colour sits a hair below the paper around it where the
    # press bit. Both are bumps rather than geometry: a fine noise for the tooth, and the print's
    # own luminance as the height so every colour edge and rule line carries a faint impression.
    # The strengths are small on purpose - the moment an edge reads as a ridge rather than a
    # surface, the board has stopped being legible for the sake of being pretty.
    coords = tree.nodes.new('ShaderNodeTexCoord')
    tooth = tree.nodes.new('ShaderNodeTexNoise')
    tooth.inputs['Scale'].default_value = 550.0
    tooth.inputs['Detail'].default_value = 5.0
    tooth.inputs['Roughness'].default_value = 0.6
    tree.links.new(coords.outputs['Object'], tooth.inputs['Vector'])

    ink = tree.nodes.new('ShaderNodeRGBToBW')
    tree.links.new(print_.outputs['Color'], ink.inputs['Color'])

    height = tree.nodes.new('ShaderNodeMath')
    height.operation = 'MULTIPLY_ADD'
    height.inputs[1].default_value = 0.30
    tree.links.new(tooth.outputs['Fac'], height.inputs[0])
    tree.links.new(ink.outputs['Val'], height.inputs[2])

    bump = tree.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.40
    bump.inputs['Distance'].default_value = 0.0005
    tree.links.new(height.outputs['Value'], bump.inputs['Height'])
    tree.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    sheen = tree.nodes.new('ShaderNodeMapRange')
    sheen.inputs['From Min'].default_value = 0.0
    sheen.inputs['From Max'].default_value = 1.0
    sheen.inputs['To Min'].default_value = 0.52
    sheen.inputs['To Max'].default_value = 0.68
    tree.links.new(tooth.outputs['Fac'], sheen.inputs['Value'])
    tree.links.new(sheen.outputs['Result'], bsdf.inputs['Roughness'])

    # Card is matte. The default 4% specular of a Principled surface lifts every dark channel by
    # a few percent of the light, and on a printed red that is the difference between #CC332E
    # and a pink - the sheen stays, but at the level uncoated stock actually has.
    bsdf.inputs['Specular IOR Level'].default_value = 0.35

    field.data.materials.clear()
    field.data.materials.append(material)


def plate():
    clear()
    cycles(SAMPLES)

    bpy.ops.import_scene.gltf(filepath=os.path.join(WORLD, 'set-ludo.glb'))

    board = bpy.data.objects.get('Board')
    field = bpy.data.objects.get('Field')

    if board is None or field is None or board.type != 'MESH' or field.type != 'MESH':
        raise SystemExit('board: the GLB no longer holds a Board and a Field mesh by those names')

    # Everything else in this file is a token or a die the market scene scatters across the board
    # for the camera, and the plate must carry none of them - the client draws every piece, from the
    # server's state, so a token baked into the background would be a piece nobody can move.
    for one in list(bpy.data.objects):
        if one.type == 'MESH' and one not in (board, field):
            bpy.data.objects.remove(one, do_unlink=True)

    extent = max(board.dimensions.x, board.dimensions.y)

    walnut(board)
    paper(field)

    # A warm interior rather than a scanner: one soft key well off the axis, so the rails throw a
    # real shadow onto the paper along two sides and the sheen on the walnut falls off across each
    # rail instead of sitting on it flat; a cooler, larger fill from the far side so nothing goes
    # black; and a dim warm-grey world for what the lacquer reflects. Nothing sits directly over the
    # board, because a light in the mirror direction of a straight-down camera puts one even
    # highlight on every flat face, which is exactly the scanner look.
    lamp((-0.42, 0.46, 0.90), 9.2, 0.80, '#FFF7EE')
    lamp((0.50, -0.40, 0.80), 12.0, 1.80, '#EAEEF5')

    overhead(extent, PLATE)
    write('ludo-plate-1024')


if __name__ == '__main__':
    plate()
    print('board: done')
