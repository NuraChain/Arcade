import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from lib import kit
from lib import pieces

kit.reset_scene()
rng = random.Random(7)

FELT_Z = -0.018
CARD = pieces.CARD_THICKNESS
SEATS = [math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4]
A, B = 0.80, 0.39


def on_oval(angle, scale):
    return (math.cos(angle) * A * scale, math.sin(angle) * B * scale)


def facing(angle):
    return angle + math.pi


cards = []
chips = []


def hole_cards(angle, folded=False):
    x, y = on_oval(angle, 0.78 if not folded else 0.55)
    for index in range(2):
        card = pieces.card('card', 'back', size='poker', face_up=False)
        offset = (index - 0.5) * (0.026 if not folded else 0.018)
        f = facing(angle)
        card.location = (x + math.cos(f + math.pi / 2) * offset + rng.uniform(-0.002, 0.002),
                         y + math.sin(f + math.pi / 2) * offset + rng.uniform(-0.002, 0.002),
                         FELT_Z + CARD * (index + 1))
        card.rotation_euler = (0, 0, f - math.pi / 2 + rng.uniform(-0.12, 0.12) + (0.5 if folded else 0))
        cards.append(card)


for seat in (SEATS[0], SEATS[2]):
    hole_cards(seat)
for seat in (SEATS[1], SEATS[3]):
    hole_cards(seat, folded=True)

community = ['AS', 'KD', '7H', '7C', '2S']
for index, code in enumerate(community):
    card = pieces.card('card', code, size='poker', face_up=True)
    card.location = ((index - 2) * 0.072 + rng.uniform(-0.002, 0.002), 0.03 + rng.uniform(-0.003, 0.003), FELT_Z + CARD)
    card.rotation_euler = (0, 0, rng.uniform(-0.05, 0.05))
    cards.append(card)

deck = pieces.deck('Deck', count=31, size='poker', top='back')
deck.location = (0.30, -0.15, FELT_Z)
deck.rotation_euler = (0, 0, 0.35)
cut = pieces.card('cut', 'back', size='poker', face_up=False)
kit.paint(cut, 'ludo_red')
cut.location = (0.30, -0.15, FELT_Z + CARD * 31)
cut.rotation_euler = (0, 0, 0.35)
cards.append(cut)

for index in range(3):
    burn = pieces.card('card', 'back', size='poker', face_up=False)
    burn.location = (0.21 + rng.uniform(-0.004, 0.004), -0.19 + rng.uniform(-0.004, 0.004), FELT_Z + CARD * (index + 1))
    burn.rotation_euler = (0, 0, 0.35 + rng.uniform(-0.2, 0.2))
    cards.append(burn)

button = pieces.dealer_button('DealerButton')
bx, by = on_oval(SEATS[0], 0.62)
button.location = (bx + 0.14, by - 0.02, FELT_Z)
button.rotation_euler = (0, 0, rng.uniform(0, math.tau))


def stack(value, count, x, y):
    obj = pieces.chip_stack('stack', value, count, seed=len(chips))
    obj.location = (x + rng.uniform(-0.002, 0.002), y + rng.uniform(-0.002, 0.002), FELT_Z)
    obj.rotation_euler = (0, 0, rng.uniform(0, math.tau))
    chips.append(obj)


for angle in (SEATS[0], SEATS[2]):
    x, y = on_oval(angle, 0.86)
    f = facing(angle)
    right = (math.cos(f + math.pi / 2), math.sin(f + math.pi / 2))
    stack('5', 20, x + right[0] * 0.075, y + right[1] * 0.075)
    stack('25', 20, x + right[0] * 0.118, y + right[1] * 0.118)
    stack('100', 9, x + right[0] * 0.10, y + right[1] * 0.10 + 0.045)
    stack('1', 6, x + right[0] * 0.14, y + right[1] * 0.14 + 0.045)

for angle in (SEATS[1], SEATS[3]):
    x, y = on_oval(angle, 0.86)
    f = facing(angle)
    right = (math.cos(f + math.pi / 2), math.sin(f + math.pi / 2))
    stack('25', 12, x + right[0] * 0.09, y + right[1] * 0.09)
    stack('5', 16, x + right[0] * 0.135, y + right[1] * 0.135)

for value, count, x, y in (('25', 7, -0.05, -0.12), ('10', 5, 0.0, -0.14), ('5', 9, 0.05, -0.115), ('100', 2, 0.02, -0.09), ('5', 1, 0.11, -0.16)):
    stack(value, count, x, y)

cards_mesh = kit.join(cards, 'Cards')
kit.assign(cards_mesh, 'print')
chips_mesh = kit.join(chips, 'Chips')
kit.assign(chips_mesh, 'print')

proxy = kit.box('proxy', size=(2.2, 1.4, 0.02), location=(0, 0, FELT_Z - 0.01), bevel_width=0)
kit.paint(proxy, 'white')

parts = [cards_mesh, chips_mesh, deck, button]
kit.bake_ao(parts, distance=0.05, samples=48, strength=0.85)
bpy.data.objects.remove(proxy, do_unlink=True)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out')
kit.render_preview(os.path.join(out, 'set-poker-dolly.png'), look_at=(0, 0, FELT_Z), distance=2.3, height=1.65, fov=34)
kit.render_preview(os.path.join(out, 'set-poker-close.png'), look_at=(0.15, -0.05, FELT_Z), distance=0.7, height=0.5, fov=40, yaw=0.5)

root = kit.parent(parts, 'PokerSet')
kit.export(kit.output_path('set-poker'), apply_modifiers_on_export=False, texcoords=True, compress=True, objects=parts + [root])
