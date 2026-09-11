import math
import os

import numpy as np


def _lattice_noise(size, cells, rng):
    grid = rng.random((cells, cells)).astype(np.float32)
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
    fx = xs / size * cells
    fy = ys / size * cells
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    tx = fx - x0
    ty = fy - y0
    tx = tx * tx * (3.0 - 2.0 * tx)
    ty = ty * ty * (3.0 - 2.0 * ty)
    x1 = (x0 + 1) % cells
    y1 = (y0 + 1) % cells
    x0 %= cells
    y0 %= cells
    a = grid[y0, x0]
    b = grid[y0, x1]
    c = grid[y1, x0]
    d = grid[y1, x1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(size, cells, octaves, rng, gain=0.5):
    total = np.zeros((size, size), np.float32)
    amplitude = 1.0
    weight = 0.0
    for octave in range(octaves):
        total += _lattice_noise(size, cells * (2 ** octave), rng) * amplitude
        weight += amplitude
        amplitude *= gain
    return total / weight


def stretched_noise(size, cells_x, cells_y, octaves, rng):
    total = np.zeros((size, size), np.float32)
    amplitude = 1.0
    weight = 0.0
    for octave in range(octaves):
        cx = cells_x * (2 ** octave)
        cy = cells_y * (2 ** octave)
        grid = rng.random((cy, cx)).astype(np.float32)
        ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
        fx = xs / size * cx
        fy = ys / size * cy
        x0 = np.floor(fx).astype(np.int64)
        y0 = np.floor(fy).astype(np.int64)
        tx = fx - x0
        ty = fy - y0
        tx = tx * tx * (3.0 - 2.0 * tx)
        ty = ty * ty * (3.0 - 2.0 * ty)
        x1 = (x0 + 1) % cx
        y1 = (y0 + 1) % cy
        x0 %= cx
        y0 %= cy
        value = (grid[y0, x0] * (1 - tx) + grid[y0, x1] * tx) * (1 - ty) + (grid[y1, x0] * (1 - tx) + grid[y1, x1] * tx) * ty
        total += value * amplitude
        weight += amplitude
        amplitude *= 0.5
    return total / weight


def walnut(size=512, seed=5):
    rng = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32) / size
    warp = fbm(size, 2, 4, rng) - 0.5
    drift = fbm(size, 1, 3, np.random.default_rng(seed + 1)) - 0.5
    phase = xs * 7.0 * (1.0 + 0.3 * drift) + warp * 1.5 + 0.05 * np.sin(ys * math.tau * 2.0)
    frac = phase - np.floor(phase)
    rings = (0.5 + 0.5 * np.sin(phase * math.tau)) ** 2.2
    lines = np.exp(-((frac - 0.5) ** 2) / 0.005)
    fine = stretched_noise(size, 200, 2, 3, np.random.default_rng(seed + 2))
    pores = stretched_noise(size, 220, 7, 2, np.random.default_rng(seed + 3))
    pores = np.clip((pores - 0.60) * 5.0, 0.0, 1.0)
    cloud = fbm(size, 3, 3, np.random.default_rng(seed + 4))
    value = 0.94 - 0.20 * rings - 0.20 * lines - 0.16 * (fine - 0.5) * 2.0 - 0.12 * pores + 0.06 * (cloud - 0.5) * 2.0
    value = np.clip(value, 0.42, 1.0)
    warmth = 0.5 + 0.5 * rings
    colour = np.stack([
        value,
        value * (0.90 - 0.07 * warmth),
        value * (0.78 - 0.12 * warmth)
    ], axis=-1)
    colour = np.clip(colour, 0.0, 1.0)
    height = 0.45 * rings + 0.35 * lines + 0.3 * fine + 0.4 * pores + 0.1 * cloud
    return colour.astype(np.float32), height.astype(np.float32)


def normal_map(height, strength=2.2):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    nx = -dx
    ny = -dy
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / length, ny / length, nz / length], axis=-1)
    return (normal * 0.5 + 0.5).astype(np.float32)


def write(path, rgb, quality=88):
    import imbuf
    size = rgb.shape[0]
    ib = imbuf.new((size, size), planes=32)
    with ib.with_buffer(write=True) as buffer:
        target = np.asarray(buffer)
        target[..., :3] = np.clip(rgb[::-1] * 255.0 + 0.5, 0, 255).astype(np.uint8)
        target[..., 3] = 255
    ib.file_type = 'WEBP' if path.lower().endswith('.webp') else 'PNG'
    ib.quality = quality
    ib.compress = 6
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    imbuf.write(ib, filepath=path)
    ib.free()


def build(out_dir, review_dir=None):
    colour, height = walnut()
    normal = normal_map(height)
    write(os.path.join(out_dir, 'wood-512.webp'), colour, quality=86)
    write(os.path.join(out_dir, 'wood-normal-512.webp'), normal, quality=92)
    if review_dir is not None:
        write(os.path.join(review_dir, 'wood-512.png'), colour)
        write(os.path.join(review_dir, 'wood-normal-512.png'), normal)
