import math
import os

import numpy as np

SIZE = 2048
GUTTER = 16

CARD_FACES = ['AS', 'KD', '7H', '7C', '2S', 'TH', 'AH', '4H', '9H', 'QS', 'JD', '5C', '8D', '3S']

SUIT_GLYPH = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}
RED_SUITS = {'H', 'D'}

CHIPS = [
    ('1', (0.94, 0.93, 0.89), (0.16, 0.34, 0.60)),
    ('5', (0.70, 0.12, 0.14), (0.94, 0.93, 0.89)),
    ('10', (0.15, 0.32, 0.62), (0.94, 0.93, 0.89)),
    ('25', (0.14, 0.44, 0.29), (0.94, 0.93, 0.89)),
    ('100', (0.10, 0.10, 0.11), (0.94, 0.93, 0.89))
]

CUBE_FACES = (2, 4, 8, 16, 32, 64)

SWATCHES = [
    ('white', (0.95, 0.95, 0.94)),
    ('black', (0.08, 0.08, 0.09)),
    ('red', (0.62, 0.10, 0.12)),
    ('ivory', (0.91, 0.88, 0.81)),
    ('cream', (0.95, 0.92, 0.84)),
    ('grey', (0.55, 0.55, 0.55))
]

LUDO_COLOURS = {
    'red': (0.80, 0.20, 0.18),
    'green': (0.18, 0.52, 0.30),
    'yellow': (0.93, 0.74, 0.18),
    'blue': (0.18, 0.40, 0.72)
}

CARD_WHITE = (0.965, 0.955, 0.935)
INK = (0.10, 0.10, 0.12)
RED_INK = (0.72, 0.10, 0.12)
OXBLOOD = (0.42, 0.08, 0.10)
OXBLOOD_LIGHT = (0.55, 0.15, 0.17)
IVORY = (0.91, 0.88, 0.80)
CREAM = (0.95, 0.92, 0.84)
PAPER_RULE = (0.62, 0.72, 0.84)
PEN = (0.16, 0.20, 0.42)

PIP_LAYOUT = {
    '2': [(1, 0), (1, 6)],
    '3': [(1, 0), (1, 3), (1, 6)],
    '4': [(0, 0), (2, 0), (0, 6), (2, 6)],
    '5': [(0, 0), (2, 0), (1, 3), (0, 6), (2, 6)],
    '6': [(0, 0), (2, 0), (0, 3), (2, 3), (0, 6), (2, 6)],
    '7': [(0, 0), (2, 0), (1, 1.5), (0, 3), (2, 3), (0, 6), (2, 6)],
    '8': [(0, 0), (2, 0), (1, 1.5), (0, 3), (2, 3), (1, 4.5), (0, 6), (2, 6)],
    '9': [(0, 0), (2, 0), (0, 2), (2, 2), (1, 3), (0, 4), (2, 4), (0, 6), (2, 6)],
    'T': [(0, 0), (2, 0), (1, 1), (0, 2), (2, 2), (0, 4), (2, 4), (1, 5), (0, 6), (2, 6)]
}


def regions():
    out = {'ludo-field': (0, 0, 1024, 1024), 'card-back': (1024, 0, 204, 288)}
    for index, face in enumerate(CARD_FACES):
        slot = index + 1
        out['card-' + face] = (1024 + 204 * (slot % 5), 288 * (slot // 5), 204, 288)
    for index, (value, _, _) in enumerate(CHIPS):
        out['chip-' + value] = (256 * index, 1024, 256, 256)
        out['chipedge-' + value] = (1280, 1024 + 48 * index, 256, 48)
    for index, number in enumerate(CUBE_FACES):
        out['cube-%d' % number] = (1536 + 80 * index, 1104, 80, 80)
    out['button'] = (1536, 1184, 128, 128)
    out['deckedge'] = (1664, 1184, 256, 96)
    out['score'] = (1664, 1296, 256, 224)
    for index, (name, _) in enumerate(SWATCHES):
        out['swatch-' + name] = (1536, 1312 + 32 * index, 32, 32)
    return out


REGIONS = regions()


def uv_rect(name, inset=GUTTER):
    x, y, w, h = REGIONS[name]
    x += inset
    y += inset
    w -= 2 * inset
    h -= 2 * inset
    return (x / SIZE, 1.0 - (y + h) / SIZE, (x + w) / SIZE, 1.0 - y / SIZE)


def uv_point(name, u, v, inset=GUTTER):
    u0, v0, u1, v1 = uv_rect(name, inset)
    return (u0 + (u1 - u0) * u, v0 + (v1 - v0) * v)


def active(name, inset=GUTTER):
    x, y, w, h = REGIONS[name]
    return (x + inset, y + inset, w - 2 * inset, h - 2 * inset)


def _fonts():
    import blf
    import bpy
    folder = bpy.utils.system_resource('DATAFILES', path='fonts')
    return {
        'inter': blf.load(os.path.join(folder, 'Inter.woff2')),
        'symbols': blf.load(os.path.join(folder, 'NotoSansSymbols2-Regular.woff2'))
    }


class Canvas:
    def __init__(self, size):
        self.size = size
        self.k = size / SIZE
        self.img = np.zeros((size, size, 3), np.float32)
        self.fonts = None

    def _window(self, x0, y0, x1, y1):
        k = self.k
        X0 = max(int(math.floor(x0 * k)) - 2, 0)
        Y0 = max(int(math.floor(y0 * k)) - 2, 0)
        X1 = min(int(math.ceil(x1 * k)) + 2, self.size)
        Y1 = min(int(math.ceil(y1 * k)) + 2, self.size)
        if X1 <= X0 or Y1 <= Y0:
            return None, None, None
        ys, xs = np.mgrid[Y0:Y1, X0:X1]
        return (slice(Y0, Y1), slice(X0, X1)), (xs + 0.5) / k, (ys + 0.5) / k

    def _blend(self, window, mask, colour):
        area = self.img[window]
        m = np.clip(mask, 0.0, 1.0)[..., None].astype(np.float32)
        area[:] = area * (1.0 - m) + np.asarray(colour, np.float32) * m

    def _coverage(self, distance):
        return np.clip(0.5 - distance * self.k, 0.0, 1.0)

    def rect(self, x, y, w, h, colour):
        k = self.k
        X0, Y0 = int(round(x * k)), int(round(y * k))
        X1, Y1 = int(round((x + w) * k)), int(round((y + h) * k))
        self.img[Y0:Y1, X0:X1] = np.asarray(colour, np.float32)

    def rounded_rect(self, cx, cy, w, h, r, colour, angle=0.0):
        half = math.hypot(w, h) / 2 + 2
        window, xs, ys = self._window(cx - half, cy - half, cx + half, cy + half)
        if window is None:
            return
        px = xs - cx
        py = ys - cy
        if angle != 0.0:
            c, s = math.cos(angle), math.sin(angle)
            px, py = px * c + py * s, -px * s + py * c
        r = min(r, w / 2, h / 2)
        qx = np.abs(px) - (w / 2 - r)
        qy = np.abs(py) - (h / 2 - r)
        outside = np.hypot(np.maximum(qx, 0.0), np.maximum(qy, 0.0))
        inside = np.minimum(np.maximum(qx, qy), 0.0)
        self._blend(window, self._coverage(outside + inside - r), colour)

    def disc(self, cx, cy, r, colour):
        window, xs, ys = self._window(cx - r, cy - r, cx + r, cy + r)
        if window is None:
            return
        self._blend(window, self._coverage(np.hypot(xs - cx, ys - cy) - r), colour)

    def ring(self, cx, cy, r, thickness, colour):
        outer = r + thickness / 2 + 1
        window, xs, ys = self._window(cx - outer, cy - outer, cx + outer, cy + outer)
        if window is None:
            return
        d = np.abs(np.hypot(xs - cx, ys - cy) - r) - thickness / 2
        self._blend(window, self._coverage(d), colour)

    def segment(self, x0, y0, x1, y1, width, colour):
        pad = width + 1
        window, xs, ys = self._window(min(x0, x1) - pad, min(y0, y1) - pad, max(x0, x1) + pad, max(y0, y1) + pad)
        if window is None:
            return
        dx, dy = x1 - x0, y1 - y0
        length2 = max(dx * dx + dy * dy, 1e-6)
        t = np.clip(((xs - x0) * dx + (ys - y0) * dy) / length2, 0.0, 1.0)
        d = np.hypot(xs - (x0 + t * dx), ys - (y0 + t * dy)) - width / 2
        self._blend(window, self._coverage(d), colour)

    def convex_polygon(self, points, colour):
        xs_all = [p[0] for p in points]
        ys_all = [p[1] for p in points]
        window, xs, ys = self._window(min(xs_all), min(ys_all), max(xs_all), max(ys_all))
        if window is None:
            return
        area2 = 0.0
        for index in range(len(points)):
            ax, ay = points[index]
            bx, by = points[(index + 1) % len(points)]
            area2 += ax * by - bx * ay
        orientation = 1.0 if area2 > 0 else -1.0
        d = None
        for index in range(len(points)):
            ax, ay = points[index]
            bx, by = points[(index + 1) % len(points)]
            ex, ey = bx - ax, by - ay
            length = max(math.hypot(ex, ey), 1e-6)
            signed = ((xs - ax) * ey - (ys - ay) * ex) / length * orientation
            d = signed if d is None else np.maximum(d, signed)
        self._blend(window, self._coverage(d), colour)

    def star(self, cx, cy, r_outer, r_inner, colour, angle=-math.pi / 2):
        outer = []
        inner = []
        for index in range(5):
            a = angle + index * math.tau / 5
            outer.append((cx + math.cos(a) * r_outer, cy + math.sin(a) * r_outer))
            b = a + math.tau / 10
            inner.append((cx + math.cos(b) * r_inner, cy + math.sin(b) * r_inner))
        self.convex_polygon(inner, colour)
        for index in range(5):
            self.convex_polygon([outer[index], inner[index], inner[index - 1]], colour)

    def _glyph_mask(self, font, string, px):
        import blf
        import imbuf
        if self.fonts is None:
            self.fonts = _fonts()
        fid = self.fonts[font]
        size = max(px * self.k, 2.0)
        blf.size(fid, size)
        width, height = blf.dimensions(fid, string)
        w = int(math.ceil(width)) + int(size) + 8
        h = int(math.ceil(size * 1.8)) + 8
        scratch = imbuf.new((w, h), planes=32)
        blf.color(fid, 1.0, 1.0, 1.0, 1.0)
        blf.position(fid, int(size * 0.5) + 4, int(size * 0.5) + 4, 0)
        with blf.bind_imbuf(fid, scratch):
            blf.draw_buffer(fid, string)
        with scratch.with_buffer() as buffer:
            pixels = np.array(buffer, dtype=np.uint8)
        scratch.free()
        alpha = pixels[..., 3].astype(np.float32) / 255.0
        if alpha.max() <= 0.0:
            alpha = pixels[..., :3].max(axis=2).astype(np.float32) / 255.0
        mask = alpha[::-1]
        rows = np.where(mask.max(axis=1) > 0.02)[0]
        cols = np.where(mask.max(axis=0) > 0.02)[0]
        if rows.size == 0 or cols.size == 0:
            return None
        return mask[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]

    def text(self, cx, cy, px, string, colour, font='inter', angle=0.0, weight=1):
        mask = self._glyph_mask(font, string, px)
        if mask is None:
            return
        if weight > 1:
            grown = mask.copy()
            for shift in range(1, weight):
                grown[:, shift:] = np.maximum(grown[:, shift:], mask[:, :-shift])
            mask = grown
        if angle != 0.0:
            mask = mask[::-1, ::-1]
        h, w = mask.shape
        X0 = int(round(cx * self.k - w / 2))
        Y0 = int(round(cy * self.k - h / 2))
        X1, Y1 = X0 + w, Y0 + h
        sx0, sy0 = max(0, -X0), max(0, -Y0)
        sx1, sy1 = w - max(0, X1 - self.size), h - max(0, Y1 - self.size)
        X0, Y0 = max(X0, 0), max(Y0, 0)
        X1, Y1 = min(X1, self.size), min(Y1, self.size)
        if X1 <= X0 or Y1 <= Y0:
            return
        self._blend((slice(Y0, Y1), slice(X0, X1)), mask[sy0:sy1, sx0:sx1], colour)

    def write(self, path, quality=85):
        import imbuf
        ib = imbuf.new((self.size, self.size), planes=32)
        with ib.with_buffer(write=True) as buffer:
            target = np.asarray(buffer)
            target[..., :3] = np.clip(self.img[::-1] * 255.0 + 0.5, 0, 255).astype(np.uint8)
            target[..., 3] = 255
        ib.file_type = 'WEBP' if path.lower().endswith('.webp') else 'PNG'
        ib.quality = quality
        ib.compress = 6
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        imbuf.write(ib, filepath=path)
        ib.free()


def _plate(canvas, name, colour):
    x, y, w, h = REGIONS[name]
    canvas.rect(x, y, w, h, colour)


def draw_card_face(canvas, code):
    name = 'card-' + code
    rank, suit = code[0], code[1]
    x, y, w, h = active(name)
    glyph = SUIT_GLYPH[suit]
    ink = RED_INK if suit in RED_SUITS else INK
    _plate(canvas, name, CARD_WHITE)
    canvas.rounded_rect(x + w / 2, y + h / 2, w, h, 10, CARD_WHITE)
    label = '10' if rank == 'T' else rank
    for corner in (0, 1):
        angle = math.pi if corner else 0.0
        sign = -1 if corner else 1
        ix = x + w / 2 + sign * (-(w / 2) + 20)
        iy = y + h / 2 + sign * (-(h / 2) + 24)
        canvas.text(ix, iy, 30, label, ink, angle=angle, weight=2)
        canvas.text(ix, iy + sign * 30, 24, glyph, ink, font='symbols', angle=angle)
    cx, cy = x + w / 2, y + h / 2
    if rank == 'A':
        canvas.text(cx, cy, 118, glyph, ink, font='symbols')
    elif rank in PIP_LAYOUT:
        columns = [cx - 42, cx, cx + 42]
        top, bottom = y + 62, y + h - 62
        for column, row in PIP_LAYOUT[rank]:
            py = top + (bottom - top) * row / 6.0
            canvas.text(columns[column], py, 36, glyph, ink, font='symbols', angle=math.pi if row > 3 else 0.0)
    else:
        frame_w, frame_h = w - 60, h - 88
        canvas.rounded_rect(cx, cy, frame_w, frame_h, 6, ink)
        canvas.rounded_rect(cx, cy, frame_w - 5, frame_h - 5, 5, CARD_WHITE)
        canvas.convex_polygon([(cx - frame_w / 2 + 3, cy + frame_h / 2 - 3), (cx + frame_w / 2 - 3, cy - frame_h / 2 + 3), (cx + frame_w / 2 - 3, cy + frame_h / 2 - 3)], (0.90, 0.86, 0.72) if suit in RED_SUITS else (0.86, 0.87, 0.90))
        canvas.text(cx, cy, 84, rank, ink, weight=3)
        canvas.text(cx - frame_w / 2 + 16, cy - frame_h / 2 + 18, 22, glyph, ink, font='symbols')
        canvas.text(cx + frame_w / 2 - 16, cy + frame_h / 2 - 18, 22, glyph, ink, font='symbols', angle=math.pi)


def draw_card_back(canvas):
    name = 'card-back'
    x, y, w, h = active(name)
    _plate(canvas, name, CARD_WHITE)
    cx, cy = x + w / 2, y + h / 2
    canvas.rounded_rect(cx, cy, w, h, 10, CARD_WHITE)
    inner_w, inner_h = w - 18, h - 18
    canvas.rounded_rect(cx, cy, inner_w, inner_h, 6, OXBLOOD)
    pitch = 14
    for i in range(-12, 13):
        for j in range(-18, 19):
            if (i + j) % 2:
                continue
            px, py = cx + i * pitch, cy + j * pitch
            if abs(px - cx) < inner_w / 2 - 10 and abs(py - cy) < inner_h / 2 - 10:
                canvas.rounded_rect(px, py, 9, 9, 1.5, OXBLOOD_LIGHT, angle=math.pi / 4)
    canvas.ring(cx, cy, 34, 3, IVORY)
    canvas.ring(cx, cy, 24, 1.5, IVORY)
    canvas.disc(cx, cy, 15, IVORY)
    canvas.text(cx, cy + 1, 20, 'N', OXBLOOD, weight=2)


def draw_chip(canvas, value, body, spot):
    name = 'chip-' + value
    x, y, w, h = active(name)
    cx, cy, r = x + w / 2, y + h / 2, w / 2
    _plate(canvas, name, body)
    canvas.disc(cx, cy, r, body)
    for index in range(6):
        a = index * math.tau / 6
        canvas.rounded_rect(cx + math.cos(a) * (r - 14), cy + math.sin(a) * (r - 14), 30, 20, 4, spot, angle=a)
    canvas.ring(cx, cy, r - 30, 2, spot)
    canvas.disc(cx, cy, r - 40, IVORY if value != '1' else (0.20, 0.36, 0.60))
    canvas.ring(cx, cy, r - 40, 3, body)
    ink = INK if value != '1' else IVORY
    canvas.text(cx, cy - 4, 52 if len(value) < 3 else 42, value, ink, weight=3)
    canvas.text(cx, cy + 34, 12, 'NURA', ink)


def draw_chip_edge(canvas, value, body, spot):
    name = 'chipedge-' + value
    x, y, w, h = active(name)
    _plate(canvas, name, body)
    for index in range(6):
        cx = x + w * (index + 0.5) / 6
        canvas.rounded_rect(cx, y + h / 2, w / 12, h * 0.9, 2, spot)


def draw_cube_faces(canvas):
    for number in CUBE_FACES:
        name = 'cube-%d' % number
        x, y, w, h = active(name)
        _plate(canvas, name, IVORY)
        canvas.text(x + w / 2, y + h / 2, 32 if number < 10 else 28, str(number), INK, weight=2)


def draw_button(canvas):
    name = 'button'
    x, y, w, h = active(name)
    cx, cy = x + w / 2, y + h / 2
    _plate(canvas, name, CARD_WHITE)
    canvas.disc(cx, cy, w / 2, CARD_WHITE)
    canvas.ring(cx, cy, w / 2 - 6, 3, INK)
    canvas.text(cx, cy, 15, 'DEALER', INK, weight=2)


def draw_deck_edge(canvas):
    name = 'deckedge'
    x, y, w, h = active(name)
    _plate(canvas, name, CARD_WHITE)
    for index in range(22):
        py = y + h * (index + 0.5) / 22
        canvas.segment(x, py, x + w, py, 1.1, (0.80, 0.79, 0.76))


def draw_score(canvas):
    name = 'score'
    x, y, w, h = active(name)
    _plate(canvas, name, CREAM)
    for index in range(1, 10):
        py = y + h * index / 10
        canvas.segment(x, py, x + w, py, 1.0, PAPER_RULE)
    canvas.segment(x + w / 2, y + 6, x + w / 2, y + h - 6, 1.6, PEN)
    canvas.segment(x + 8, y + h / 10 + 2, x + w - 8, y + h / 10 + 2, 1.6, PEN)
    for column, count in ((0, 5), (1, 3)):
        base = x + (w / 4) * (1 + 2 * column)
        for stroke in range(count):
            sx = base - 24 + stroke * 12
            canvas.segment(sx, y + h * 0.28, sx + 2, y + h * 0.28 + 26, 2.2, PEN)
        if count >= 5:
            canvas.segment(base - 30, y + h * 0.28 + 24, base + 26, y + h * 0.28 + 4, 2.2, PEN)
        for stroke in range(2 if column == 0 else 4):
            sx = base - 24 + stroke * 12
            canvas.segment(sx, y + h * 0.48, sx + 2, y + h * 0.48 + 26, 2.2, PEN)


def draw_swatches(canvas):
    for name, colour in SWATCHES:
        _plate(canvas, 'swatch-' + name, colour)


def draw_ludo(canvas):
    name = 'ludo-field'
    x, y, w, h = REGIONS[name]
    board = CREAM
    line = (0.36, 0.30, 0.24)
    _plate(canvas, name, board)
    margin = 32
    canvas.rounded_rect(x + w / 2, y + h / 2, w - 2 * margin + 8, h - 2 * margin + 8, 6, line)
    canvas.rounded_rect(x + w / 2, y + h / 2, w - 2 * margin + 2, h - 2 * margin + 2, 5, board)
    cell = (w - 2 * margin) / 15
    ox, oy = x + margin, y + margin

    def cell_rect(col, row):
        return (ox + col * cell, oy + row * cell, cell, cell)

    def fill_cell(col, row, colour):
        cx, cy, cw, ch = cell_rect(col, row)
        canvas.rect(cx, cy, cw, ch, colour)

    corners = {'red': (0, 0), 'green': (9, 0), 'yellow': (9, 9), 'blue': (0, 9)}
    for colour_name, (c0, r0) in corners.items():
        colour = LUDO_COLOURS[colour_name]
        bx, by = ox + c0 * cell, oy + r0 * cell
        canvas.rect(bx, by, 6 * cell, 6 * cell, colour)
        canvas.rounded_rect(bx + 3 * cell, by + 3 * cell, 4 * cell, 4 * cell, 12, CARD_WHITE)
        for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            canvas.disc(bx + 3 * cell + dx * cell * 0.95, by + 3 * cell + dy * cell * 0.95, cell * 0.42, colour)

    track = []
    for col in range(6, 9):
        for row in list(range(0, 6)) + list(range(9, 15)):
            track.append((col, row))
    for row in range(6, 9):
        for col in list(range(0, 6)) + list(range(9, 15)):
            track.append((col, row))
    for col, row in track:
        fill_cell(col, row, CARD_WHITE)

    homes = {
        'red': [(c, 7) for c in range(1, 6)],
        'green': [(7, r) for r in range(1, 6)],
        'yellow': [(c, 7) for c in range(9, 14)],
        'blue': [(7, r) for r in range(9, 14)]
    }
    starts = {'red': (1, 6), 'green': (8, 1), 'yellow': (13, 8), 'blue': (6, 13)}
    for colour_name, cells in homes.items():
        for col, row in cells:
            fill_cell(col, row, LUDO_COLOURS[colour_name])
        fill_cell(*starts[colour_name], LUDO_COLOURS[colour_name])

    centre_x, centre_y = ox + 7.5 * cell, oy + 7.5 * cell
    half = 1.5 * cell
    canvas.convex_polygon([(centre_x - half, centre_y - half), (centre_x + half, centre_y - half), (centre_x, centre_y)], LUDO_COLOURS['green'])
    canvas.convex_polygon([(centre_x + half, centre_y - half), (centre_x + half, centre_y + half), (centre_x, centre_y)], LUDO_COLOURS['yellow'])
    canvas.convex_polygon([(centre_x + half, centre_y + half), (centre_x - half, centre_y + half), (centre_x, centre_y)], LUDO_COLOURS['blue'])
    canvas.convex_polygon([(centre_x - half, centre_y + half), (centre_x - half, centre_y - half), (centre_x, centre_y)], LUDO_COLOURS['red'])

    for col, row in track:
        cx, cy, cw, ch = cell_rect(col, row)
        canvas.segment(cx, cy, cx + cw, cy, 1.4, line)
        canvas.segment(cx, cy + ch, cx + cw, cy + ch, 1.4, line)
        canvas.segment(cx, cy, cx, cy + ch, 1.4, line)
        canvas.segment(cx + cw, cy, cx + cw, cy + ch, 1.4, line)

    safe = list(starts.values()) + [(6, 2), (12, 6), (8, 12), (2, 8)]
    for col, row in safe:
        cx, cy, cw, ch = cell_rect(col, row)
        colour = CARD_WHITE if (col, row) in starts.values() else (0.55, 0.47, 0.36)
        canvas.star(cx + cw / 2, cy + ch / 2, cw * 0.36, cw * 0.15, colour)


def draw_all(canvas):
    canvas.img[:] = np.asarray((0.12, 0.10, 0.09), np.float32)
    draw_ludo(canvas)
    draw_card_back(canvas)
    for code in CARD_FACES:
        draw_card_face(canvas, code)
    for value, body, spot in CHIPS:
        draw_chip(canvas, value, body, spot)
        draw_chip_edge(canvas, value, body, spot)
    draw_cube_faces(canvas)
    draw_button(canvas)
    draw_deck_edge(canvas)
    draw_score(canvas)
    draw_swatches(canvas)
