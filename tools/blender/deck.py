"""
The fifty-two card faces a player presses, drawn by the code that prints the deck in the market.

Run by hand, like `art.py` and `board.py`, because `lib/atlas.py` reaches for Blender's font module:

    blender -b -P tools/blender/deck.py

  public/board/deck-1989.webp   thirteen ranks across, four suits down

`lib/atlas.py` has drawn real card faces since long before any of this - corner indices in both
orientations, the pip layouts, a framed court with its diagonal wash - and the 3D deck scattered
across the market's card table is printed from it. It only ever needed fourteen of them, because a
prop is whatever happens to be face up. The game needs all fifty-two, so this asks that same
function for the rest rather than drawing a second deck: two descriptions of one object agree
exactly until somebody edits a pip, and then a card in the hand and the same card on the table are
different cards.

**The grid IS the card number.** `hokm/cards.ts` numbers a card suit-major with the ranks ascending,
so the column is the rank and the row is the suit and there is no layout for the client to know
beyond thirteen by four. A sheet packed to fit - eight across and seven down, say - would be a
second fact that has to agree with a constant in `data/cards.ts`, which is the shape of mistake this
repository keeps writing down.

The scale is three quarters of the atlas's own, so a cell is 153x216: a card is about 44 CSS pixels
wide on a phone, and 153 covers that at three times the device ratio with room left over. Drawing
them larger would be bytes nobody's screen can resolve.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib import atlas

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'application', 'public', 'board')

RANKS = '23456789TJQKA'
SUITS = 'CDHS'

CELL_W = 204
CELL_H = 288
SCALE = 0.75


def sheet():
    width = int(round(CELL_W * len(RANKS) * SCALE))
    height = int(round(CELL_H * len(SUITS) * SCALE))

    canvas = atlas.Canvas(width, height, scale=SCALE)

    for row, suit in enumerate(SUITS):
        for column, rank in enumerate(RANKS):
            atlas.draw_card_face(canvas, rank + suit, box=(column * CELL_W, row * CELL_H, CELL_W, CELL_H))

    target = os.path.join(OUT, 'deck-%d.webp' % width)
    canvas.write(target, quality=90)

    print('deck: wrote %s (%d x %d, %d bytes)' % (target, width, height, os.path.getsize(target)))


if __name__ == '__main__':
    sheet()
    print('deck: done')
