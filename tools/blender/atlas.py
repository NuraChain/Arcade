import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib import atlas
from lib import wood

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('NURA_OUT') or os.path.abspath(os.path.join(HERE, '..', '..', 'application', 'public', 'world'))
REVIEW = os.path.join(HERE, 'out')

started = time.time()
for size in (2048, 1024):
    canvas = atlas.Canvas(size)
    atlas.draw_all(canvas)
    target = os.path.join(OUT, 'atlas-%d.webp' % size)
    canvas.write(target, quality=88)
    print('ATLAS', target, os.path.getsize(target), 'bytes')
    if size == 2048:
        review = os.path.join(REVIEW, 'atlas-2048.png')
        canvas.write(review)
        print('REVIEW', review)
wood.build(OUT, REVIEW)
print('WOOD', os.path.getsize(os.path.join(OUT, 'wood-512.webp')), os.path.getsize(os.path.join(OUT, 'wood-normal-512.webp')))
print('ATLAS_DONE %.1fs' % (time.time() - started))
