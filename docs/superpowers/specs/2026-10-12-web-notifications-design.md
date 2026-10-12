# Web notifications that say what happened

The owner, 2026-10-12: "add web notification also with disable enable on setting on every game
or chat or every where that i needs it".

Read as: when something happens that the reader would want to know and they are not looking at
Nura Games, the browser tells them, in their language, what it was; and Settings has a switch
for this device and a switch for each kind of thing.

## 1. What there is today

Verified in the code on 2026-10-12.

| Piece | Where | What it does |
|---|---|---|
| Kinds | `notificationKind` in `backend/src/schemas.ts` | `friend-request`, `friend-accepted`, `group-added`, `table-invite`, `table-removed`, `message`, `turn`. A `turn` is written only at a table that gives a day a move. |
| Categories | `backend/src/domains/notify/notices.ts` | `invites`, `requests`, `messages`, `groups`, `turns`. A mute on a category (`subject_kind = 'notice'`) stops the row being written at all. |
| The doorbell | `tell` in `backend/src/services.ts` | Writes the row, rings every open page of that account (`selfChanged(..., 'notifications')`) and wakes its push subscriptions. |
| Push | `domains/notify/push.ts` | VAPID only, NO payload, and nothing at all unless the three `VAPID_*` values are set. |
| The worker | `frontend/public/push-worker.js` | Shows one notice for every push: "Nura Games / Something happened. Open Nura Games to see.", in English, and a click focuses any open tab or opens the list. |
| In the page | `frontend/src/stores/cues.store.ts` | A toast and a chime at four points: a message in a thread that is not open, a friend request, any other unread notification, and a game starting at a table the reader is not looking at. The sentence and where it leads are `sayOf` and `targetOf` in `lib/notifications.ts`. |
| Settings | `settings.page.azeroth`, `push-toggle.component.azeroth` | One switch for each category and, only when the server has push keys, a button for this device. |

## 2. What is missing

1. **Nothing outside the page says what happened.** The one notice there is says "something".
2. **It is in English whatever the reader's language.**
3. **A tab that is open but not looked at is told nothing.** The toast is drawn in a page nobody
   sees. With push keys the worker shows its one sentence; without them, nothing.
4. **A server with no push keys offers no switch at all**, though a browser can show a
   notification for an open tab with no push service involved.
5. **A click goes to the list**, not to the thread, the table or the request.
6. **A live table tells nobody outside it.** The game the reader queued for starting, and their
   turn at a table with forty-five seconds on the clock, are a toast in the page and nothing else.

## 3. The design

### N1. One sentence, three outlets

What is said is one function of what happened (`sayOf`, and where a click leads `targetOf`).
The outlets are the toast in the page (as now), a system notification from the page while the
document is hidden, and a system notification from the worker when a push arrives and no page is
being looked at. All three name the subject with one tag (`kind:subject`: a thread, a table, a
person), so the second and third are one notice on the screen, never two, and a burst in one
thread is one notice that is refreshed.

### N2. The page tells the system when nobody is looking

`lib/system-notice.ts` (new, no framework): `tell({ title, tag, target, lang, dir })` shows a
notification through the worker's registration (`registration.showNotification`, which also
works where `new Notification` does not) when all of these hold: the device switch is on,
permission is granted, and `document.visibilityState` is `hidden`. The cues store calls it at
its four points, beside `toasts.show`, with the sentence it already has.

Two cues are added to that store, both from what the page already knows:

- **the reader's turn anywhere** (`lobby.waiting()` gaining a table that is not the one on the
  screen, or any table while the document is hidden): "Your turn at Ludo";
- **a game starting** is there already (`live.onGame`) and gains the outlet.

When the document becomes visible again every notice of ours is closed
(`registration.getNotifications()`): the page has the truth now.

### N3. The worker says what happened

On a push the worker asks the api what is unread (`GET /api/notifications/`, over the session
cookie the browser already holds), takes the newest row and shows the same sentence the page
would. The push stays without a payload, so nothing about who said what crosses a push service,
and the rule in `push.ts` stands. The words come from a small cache the page writes when the
device switch is turned on and whenever the language changes (`caches`, one JSON: the language,
its direction, the seven sentences with their plural forms, the game names). A row names whoever
did it by handle, and the worker asks for the name the way the page does
(`GET /api/social/names`). With no cache, no session or no answer, the worker shows the one
general sentence, in the cached language if it has one: a push must show something.

When a page of ours is visible the worker shows nothing; the page has a toast.

### N4. A click goes to the thing

Every notice carries `data.target`. On a click the worker focuses an open tab and posts it the
target, and the shell (which owns the router) goes there; with no tab it opens the target itself.

### N5. The switches

- **This device** (`settings.notify`, kept in this browser as the other device settings are):
  off, on, or blocked by the browser, with the sentence that says how to unblock it. Turning it
  on asks for permission, registers the worker and, when the server has push keys, subscribes.
  The panel says which it is: "also when Nura Games is closed" or "while Nura Games is open in
  a tab". It is offered whether or not the server has keys.
- **Each kind** (the five category switches, account-wide, as now). "Your turn in a turn-based
  game" becomes "Games: your turn, and a game starting", because that switch now also governs
  the two cues of N2.

### N6. What is never shown

Message text. The server cannot read it and a lock screen should not show it. A message is
"Sara sent you a message", as in the page.

## 4. Decisions taken as defaults

The owner can change any of them; none blocks the work.

| # | Decision | Why |
|---|---|---|
| N-D1 | No switch for each kind on each device: one device switch, five kinds for the account. | A push cannot be skipped by a device (a push that shows nothing is replaced by the browser's own notice), so a device-by-kind table would promise what the closed-page path cannot keep. |
| N-D2 | The page notifies only while its document is hidden. | A visible page has the toast. Two notices for one thing is the noise the tag exists to prevent. |
| N-D3 | No new category for live tables: they are under "Games". | Six switches where five will do. |
| N-D4 | No server change. | The list route, the mutes and the push are already what the three outlets need. |
| N-D5 | The title is the sentence and there is no body. | The browser prints the site under it already. |

## 5. Commits

Each with its specs, driven in a real browser, and the notes it makes false.

- N.1 `docs(spec)`: this file.
- N.2 `feat(notify)`: the device switch, and a notice from the page when nobody is looking.
  `lib/system-notice.ts`, the cues store's outlet, the two cues, `settings.notify`, the panel
  that replaces `PushToggle`, the words in both languages.
- N.3 `feat(notify)`: a click goes to the thing itself. The worker's click, the shell's listener.
- N.4 `feat(notify)`: the worker says what happened. The words cache, the worker's read of the
  list, the fallback.
- N.5 `test(qa)`: `tools/qa/notify-pass.mjs` on the built server. Two accounts in two browsers
  with the permission granted: a message, a friend request, a table invite and a turn each
  reach a hidden page as one notice with the right sentence in English and in Persian, a second
  message in the same thread refreshes it and adds none, a visible page gets none, a muted kind
  gets none, the switch turned off gets none, and a click lands on the thread.

## 6. What it does not do

- It does not make a phone ring when the app is closed on a server with no push keys. That
  needs the three `VAPID_*` values in `.env`, which are the owner's.
- It adds no email and no sound outside the page.
