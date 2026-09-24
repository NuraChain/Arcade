import os

from lib import kit


def _art(name):
    return os.path.join(kit.ART, name)


def plinth():
    return kit.material('plinth', base='#141D2E', roughness=0.34, coat=1.0, coat_roughness=0.06)


def plinth_band():
    return kit.material('plinth-band', base='#0E1524', roughness=0.55)


def walnut():
    return kit.material(
        'walnut',
        base_image=kit.texture('dark_wood', 'Diffuse'),
        roughness_image=kit.texture('dark_wood', 'Rough'),
        normal_image=kit.texture('dark_wood', 'nor_gl'),
        normal_strength=0.6,
        coat=0.7,
        coat_roughness=0.12,
        uv_scale=2.2
    )


def baize():
    return kit.material(
        'baize',
        base='#1C5E47',
        roughness=0.92,
        sheen=0.8,
        sheen_roughness=0.35,
        sheen_tint='#7FD3B0',
        normal_image=kit.texture('scuba_suede', 'nor_gl'),
        normal_strength=0.35,
        uv_scale=3.0
    )


def felt():
    return kit.material(
        'felt',
        base=kit.token('poker-felt'),
        roughness=0.9,
        sheen=0.8,
        sheen_roughness=0.4,
        sheen_tint='#86E0BD',
        normal_image=kit.texture('scuba_suede', 'nor_gl'),
        normal_strength=0.35,
        uv_scale=3.0
    )


def leather():
    return kit.material('leather', base=kit.token('poker-rail'), roughness=0.46, coat=0.35, coat_roughness=0.3)


def brass():
    return kit.material('brass', base='#C9A15C', roughness=0.28, metallic=1.0)


def card():
    return kit.material('card', base_image=_art('cards.png'), roughness=0.38, coat=0.3, coat_roughness=0.14)


def chip():
    return kit.material('chip', base_image=_art('chips.png'), roughness=0.42, coat=0.18, coat_roughness=0.2)


def ink():
    return kit.material('ink', base='#101624', roughness=0.4)


def ivory():
    return kit.material('ivory', base='#F4EEDD', roughness=0.3, coat=0.6, coat_roughness=0.08)


def sticker():
    return kit.material('sticker', base='#FFFFFF', roughness=0.36, coat=0.4, coat_roughness=0.1)


def ludo_ink():
    return kit.material('ludo-ink', base='#2A1E5C', roughness=0.4)


def ludo_board():
    return kit.material('ludo-board', base_image=_art('ludo-board.png'), roughness=0.42, coat=0.3, coat_roughness=0.14)


def ludo_side():
    return kit.material('ludo-side', base='#D07A3A', roughness=0.42, coat=0.4, coat_roughness=0.12)


def pawn(colour):
    return kit.material('pawn-' + colour, base=kit.token('ludo-' + colour), roughness=0.28, coat=0.8, coat_roughness=0.06)


def nard(name):
    return kit.material('nard-' + name, base=kit.token('nard-' + name), roughness=0.5, coat=0.15, coat_roughness=0.2)


def nard_field():
    return kit.material('nard-field', base=kit.token('nard-field'), roughness=0.62)


def checker(side):
    return kit.material('checker-' + side, base=kit.token('nard-' + side), roughness=0.3, coat=0.9, coat_roughness=0.05)


def checker_rim(side):
    return kit.material('checker-' + side + '-rim', base=kit.token('nard-' + side + '-rim'), roughness=0.34, coat=0.9, coat_roughness=0.05)
