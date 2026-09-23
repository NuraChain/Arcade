# Chat actions: reply, react, forward, delete, format

Date: 2026-09-23. Owner request: "reply delete forward message, complete things about chat, emojis,
I like Discord chat, it supports read-me things". Built under `nura-e2ee/v1`, so every choice below
starts from what the server may and may not learn.

## What the server learns

| action | server sees | server does not see |
|---|---|---|
| reply | nothing new | which message is quoted - it is inside the ciphertext |
| forward | a new message, like any other | that it was forwarded, or from where |
| react | that somebody reacted, to which message, when | the emoji |
| delete | that the author removed one of their own messages | what it said (it never did) |
| format | nothing | the markup is part of the words |

The reaction target is the one new piece of metadata, and it is in the clear because the thread is
paged by the server: a reaction whose target only the client knows would force every client to
download every reaction in the room to draw one page. Who reacted to what is the same class of fact
as who replied when, which the server already holds; the emoji itself stays sealed.

## The plaintext becomes a document

Until now the plaintext of a sealed message was the typed words. It becomes a small JSON document,
because a reply and a forward are facts about the message that the reader must be able to trust,
and inside the ciphertext is the only place the server cannot edit them:

```
text      {"text": "...", "reply": "<messageId>"?, "fwd": true?}
reaction  {"react": "<emoji>", "on": "<messageId>"}
```

This is a hard cutover of the plaintext, not of the envelope: the AAD, the signature and the
franking construction do not move. Nothing has shipped, every development thread is rebuilt from
nothing, and the sealed test corpus is regenerated through the same encoder. The franking commitment
covers the whole document, so a disclosure carries the document and the report sheet renders its
words.

`lib/body.ts` owns the format and nothing else composes or parses it. A document that does not
parse, or a reaction whose `on` disagrees with the row's `target`, opens as `tampered` - the server
moving a reaction onto another message is exactly the relabelling the AAD exists to refuse, and the
`on` field is what makes it detectable without adding a field to the AAD.

## Schema

`messages.kind` gains `reaction` and `deleted`.

- `reaction` is sealed exactly like `text`: the full envelope, a sender, a frank. It carries
  `target_id`, a foreign key to `messages(id)` with `ON DELETE CASCADE`, and a CHECK makes
  `target_id` present exactly when the kind is `reaction`.
- `deleted` is a TOMBSTONE. Deleting a text message keeps the row's id, sender, sequence number,
  epoch, device, client time and expiry, and nulls the body and every cryptographic field. It is
  kept rather than removed for three reasons: the sender's sequence counter stays monotone (the
  next sequence number is the maximum the server holds), a reply can say its original was deleted
  rather than that it was never loaded, and every browser holding the plaintext in its search
  archive learns to drop it.
- `messages_sender_seq` becomes unique over rows that HAVE a sequence number, which is every row a
  device wrote, whichever kind it is now.

## Wire

- `POST /chat/:id/messages` takes `kind: 'text' | 'reaction'` and, for a reaction, `target`. The
  target must be a text message in the same conversation.
- `DELETE /chat/:id/messages/:messageId` - the author only. A text message becomes a tombstone and
  its reactions go with it, in one transaction; a reaction is removed outright, because taking a
  reaction back is not an event anybody needs recorded.
- A thread page carries text, lines and tombstones, never reactions. Each text message carries the
  reactions on it as `reactions: chatMessage[]`, each one a sealed row the browser opens and checks
  like any other.
- The list's last message and unread count ignore reactions and tombstones. A reaction writes no
  notification and sends no push.

## Browser

- **Reply.** Hover (fine pointer) or long-press (coarse) offers Reply. The composer shows a strip
  naming who is being replied to and the first line of what they said, with a close button. The
  bubble shows the quoted line above the words; pressing it scrolls to the original and flashes it.
  A quote whose original is not loaded says so, and one whose original was deleted says that.
- **React.** Six quick reactions in the hover bar and the long-press sheet, and a picker behind a
  plus. Under a bubble, one chip per emoji with a count; mine is outlined in accent; pressing a chip
  toggles mine. Several of one person's rows with one emoji count once, and taking it back removes
  all of them.
- **Forward.** A sheet listing the reader's conversations with a search box; picking one seals the
  words anew in that room with `fwd: true`. The bubble says "Forwarded" above the words. The
  original author is not carried: forwarding into another room must not publish who said it there.
- **Delete.** Own messages only, behind a confirm. The thread drops the bubble; the archive drops
  the plaintext.
- **Copy.** The words, to the clipboard.
- **Format.** Discord's markdown, rendered by building DOM nodes (never `innerHTML`): `**bold**`,
  `*italic*` and `_italic_`, `__underline__`, `~~strike~~`, `||spoiler||` (hidden until pressed),
  `` `code` ``, fenced code blocks, `> quote` lines, `#`/`##`/`###` headings, `-` lists, and bare
  http(s) links opened with `noopener noreferrer`. Masked links are not supported: a link whose
  text lies about its target is a phishing primitive, and Discord itself warns before following one.
- **Emoji picker.** A curated set in categories with English keywords, a search box, and a recent
  row kept per device in `settings.store`. In the composer it docks above the input; for a reaction
  it opens as a sheet on a phone and a dialog elsewhere. Emoji are the user's content, which is the
  one place an OS-drawn glyph belongs; the product's own chrome still draws none.

The table chat gets reply and reactions through the same bubble; forward and delete live on the
chat page, where there is room for the sheets they open.

## Testing

- `server/tests/chat.db.spec.ts`: a reaction needs a text target in the same room; the page never
  carries a reaction and carries them on their target; deleting is author-only, leaves a tombstone,
  takes the reactions with it; unread and the list's last line ignore both kinds.
- `application/tests/body.spec.ts`: encode/decode round trip, a mismatched `on` is refused, a
  document that is not an object is refused.
- `application/tests/markdown.spec.ts`: every syntax, nesting, an unterminated marker left as text,
  a `javascript:` url never becomes a link.
- The browser: reply, react, forward and delete between two wallet fixtures, in both languages, at
  390 and 1280.
