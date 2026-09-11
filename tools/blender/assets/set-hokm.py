import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from lib import kit
from lib import pieces

kit.reset_scene()
rng = random.Random(3)

CARD = pieces.CARD_THICKNESS
SEATS = [0.0, math.pi / 2, math.pi, 3 * math.pi / 2]
HAND_RADIUS = 0.60


def facing(angle):
    return angle + math.pi


hands = []
for index, angle in enumerate(SEATS):
    cards = [pieces.card('card', 'back', size='bridge', face_up=False) for _ in range(7)]
    cx, cy = math.cos(angle) * HAND_RADIUS, math.sin(angle) * HAND_RADIUS
    pieces.fan(cards, cx, cy, 0.0, facing(angle), spread=5.5, pivot=0.085, bow=0.003)
    for card in cards:
        card.rotation_euler = (0, 0, card.rotation_euler.z + rng.uniform(-0.01, 0.01))
    hands.extend(cards)

trick = []
lead = ['TH', 'AH', '4H', '7H']
for index, code in enumerate(lead):
    angle = SEATS[(1 + index) % 4]
    card = pieces.card('card', code, size='bridge', face_up=True)
    f = facing(angle)
    distance = 0.075 + index * 0.006
    card.location = (math.cos(angle) * distance + rng.uniform(-0.006, 0.006), math.sin(angle) * distance + rng.uniform(-0.006, 0.006), CARD * (index + 1))
    card.rotation_euler = (0, 0, f - math.pi / 2 + rng.uniform(-0.14, 0.14))
    trick.append(card)

won = []
for team, (angle, count) in enumerate(((SEATS[0], 12), (SEATS[1], 8))):
    base_x = math.cos(angle) * 0.52 + math.cos(angle + math.pi / 2) * 0.24
    base_y = math.sin(angle) * 0.52 + math.sin(angle + math.pi / 2) * 0.24
    for index in range(count):
        card = pieces.card('card', 'back', size='bridge', face_up=False)
        card.location = (base_x + rng.uniform(-0.004, 0.004), base_y + rng.uniform(-0.004, 0.004), CARD * (index + 1))
        card.rotation_euler = (0, 0, angle + rng.uniform(-0.25, 0.25))
        won.append(card)

hands_mesh = kit.join(hands, 'Hands')
kit.assign(hands_mesh, 'print')
trick_mesh = kit.join(trick, 'Trick')
kit.assign(trick_mesh, 'print')
won_mesh = kit.join(won, 'WonTricks')
kit.assign(won_mesh, 'print')

tea_parts = []
for angle, offset in ((SEATS[2], -0.26), (SEATS[3], 0.24)):
    x = math.cos(angle) * 0.56 + math.cos(angle + math.pi / 2) * offset
    y = math.sin(angle) * 0.56 + math.sin(angle + math.pi / 2) * offset
    for part in pieces.estekan('estekan'):
        part.location = (part.location.x + x, part.location.y + y, part.location.z)
        tea_parts.append(part)
glass_parts = [p for p in tea_parts if p.data.materials[0].name == 'glass']
other_parts = [p for p in tea_parts if p.data.materials[0].name != 'glass']
glass_mesh = kit.join(glass_parts, 'TeaGlass')
kit.assign(glass_mesh, 'glass')
lacquer_tea = [p for p in other_parts if p.data.materials[0].name == 'lacquer']
brass_tea = [p for p in other_parts if p.data.materials[0].name == 'brass']
tea_mesh = kit.join(lacquer_tea, 'Tea')
kit.assign(tea_mesh, 'lacquer')
rim_mesh = kit.join(brass_tea, 'TeaRims')
kit.assign(rim_mesh, 'brass')

seed_bowl = pieces.bowl('SeedBowl', radius=0.062, height=0.034, colour_name='ivory')
seed_bowl.location = (-0.30, 0.30, 0.0)
seeds = pieces.mound('Seeds', radius=0.046, height=0.02, colour_name='enamel_sand')
seeds.location = (-0.30, 0.30, 0.016)
shell_bowl = pieces.bowl('ShellBowl', radius=0.046, height=0.026, colour_name='enamel_green')
shell_bowl.location = (-0.19, 0.36, 0.0)
shells = pieces.mound('Shells', radius=0.030, height=0.009, colour_name='ivory_dim')
shells.location = (-0.19, 0.36, 0.012)

sheet = pieces.score_sheet('ScoreSheet')
sheet.location = (0.34, 0.26, 0.0)
sheet.rotation_euler = (0, 0, -0.35)

pen = kit.cylinder('Pen', radius=0.0042, depth=0.14, sides=14, location=(0.36, 0.20, 0.0042), rotation=(0, math.pi / 2, 0.55), bevel_width=0)
kit.paint(pen, 'ebony')
kit.smooth(pen, 40.0)
kit.assign(pen, 'lacquer')
clip = kit.cylinder('PenClip', radius=0.0046, depth=0.018, sides=14, location=(0.36 + math.cos(0.55) * 0.052, 0.20 + math.sin(0.55) * 0.052, 0.0042), rotation=(0, math.pi / 2, 0.55), bevel_width=0)
kit.paint(clip, 'brass')
kit.smooth(clip, 40.0)
kit.assign(clip, 'brass')

proxy = kit.box('proxy', size=(2.0, 2.0, 0.02), location=(0, 0, -0.01), bevel_width=0)
kit.paint(proxy, 'white')

parts = [hands_mesh, trick_mesh, won_mesh, glass_mesh, tea_mesh, rim_mesh, seed_bowl, seeds, shell_bowl, shells, sheet, pen, clip]
kit.bake_ao(parts, distance=0.05, samples=48, strength=0.85)
bpy.data.objects.remove(proxy, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'set-hokm-dolly.png'), look_at=(0, 0, 0.0), distance=2.3, height=1.65, fov=34)
kit.render_preview(os.path.join(out, 'set-hokm-close.png'), look_at=(-0.05, 0.05, 0.0), distance=0.75, height=0.55, fov=40, yaw=0.4)

root = kit.parent(parts, 'HokmSet')
kit.export(kit.output_path('set-hokm'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
