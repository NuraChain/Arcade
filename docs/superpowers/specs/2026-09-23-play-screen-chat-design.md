# The play screen and its chat - design

The owner: "that chat box, I mean the whole chat, is ugly - we can position-fix it, or whatever is the
best UI/UX for it on desktop", and "analyse all of the sections to have the best of it".

## What the screen is today, section by section

| Section | Today | Problem |
|---|---|---|
| Header | title, other tables, a tools pill, one bar | fine; stays |
| Table | wood panel, board, player plates beside it, status strip | fine; gets the width the rail took |
| Chat, desktop | a full-height column docked to the right (`aside`, `--social-w`, widenable) with Chat / Players tabs | takes a third of the width for a thread that is quiet most of a game; a second app beside the game rather than part of it; its header does not line up with anything |
| Chat, phone | a bottom sheet at 48% or full height | right for a phone; stays |
| Who said what | only inside the chat | nobody looking at the board sees a message arrive |

## Decisions

| # | Decision | Why |
|---|---|---|
| P1 | **On a desktop (any posture but phone) the chat is a floating card**, anchored to the bottom-right corner, 23rem wide and at most 34rem tall; "bigger" makes it 30rem and the full height less the top bar. | chess.com, Board Game Arena and Ludo King on desktop all float or tuck the chat; the game keeps the width. |
| P2 | **Closed, it is a pill** in the same corner: the chat icon, "Chat", the unread count, and the last line said while it was closed. | A closed chat must still say when somebody spoke. |
| P3 | **The card stays mounted when closed** and is hidden. | The thread stays open, so the unread count and the speech bubbles keep working, and reopening is instant with the scroll where it was. |
| P4 | **Speech bubbles on the player plates**: a text line from somebody at the table appears above their plate for 4.5 s, on every screen size. Lines the server wrote do not. | This is what game chat looks like in every board game people know, and it is the only way a message reaches somebody looking at the board. |
| P5 | **The phone keeps its bottom sheet.** | A floating card has nowhere to float on a phone. |
| P6 | `settings.railOpen` keeps its meaning - "the chat is open on a desktop" - so the preference survives. | No new setting for the same thing. |

## Verification

The table at 1280 and 1440 with the card open, closed, and bigger; a message arriving while closed
(the pill shows it and the plate shows the bubble); the phone sheet unchanged; both languages; the
matrix.
