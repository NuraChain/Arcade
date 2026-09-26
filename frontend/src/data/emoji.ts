export type EmojiGroup = 'smileys' | 'people' | 'hearts' | 'play' | 'nature' | 'food' | 'objects' | 'symbols' | 'flags';

export interface Emoji
{
    char: string;
    words: string;
}

const SMILEYS = '😀 grin happy smile|😃 smile happy joy|😄 smile laugh happy|😁 beam grin|😆 laugh squint|😅 sweat relief nervous|🤣 rofl rolling laugh|😂 joy tears laugh lol|🙂 slight smile|🙃 upside down silly|😉 wink|😊 blush smile|😇 halo angel innocent|🥰 love hearts adore|😍 heart eyes love|🤩 star struck wow|😘 kiss blow|😗 kiss|😚 kiss closed|😋 yum tasty|😛 tongue|😜 wink tongue crazy|🤪 zany crazy|😝 squint tongue|🤑 money rich|🤗 hug|🤭 giggle oops|🤫 shush quiet|🤔 think hmm|🤐 zip mouth secret|🤨 raised eyebrow sus|😐 neutral meh|😑 expressionless|😶 no mouth speechless|😏 smirk|😒 unamused|🙄 eye roll|😬 grimace awkward|😮‍💨 exhale sigh|🤥 lie pinocchio|😌 relieved calm|😔 pensive sad|😪 sleepy|🤤 drool|😴 sleep zzz|😷 mask sick|🤒 fever sick|🤕 hurt bandage|🤢 nausea sick|🤮 vomit|🥵 hot sweat|🥶 cold freeze|🥴 woozy dizzy|😵 dizzy knocked|🤯 mind blown shock|🤠 cowboy|🥳 party celebrate|🥸 disguise|😎 cool sunglasses|🤓 nerd geek|🧐 monocle inspect|😕 confused|😟 worried|🙁 frown|😮 open mouth wow|😯 hushed surprised|😲 astonished shock|😳 flushed embarrassed|🥺 pleading puppy|🥹 holding tears|😦 frowning|😧 anguished|😨 fearful scared|😰 anxious sweat|😥 sad relieved|😢 cry tear sad|😭 sob crying|😱 scream fear|😖 confounded|😣 persevere|😞 disappointed|😓 downcast sweat|😩 weary tired|😫 tired|🥱 yawn bored|😤 triumph huff|😡 angry rage|😠 angry mad|🤬 swear cursing|😈 devil smirk|👿 imp angry|💀 skull dead lol|☠️ skull crossbones|💩 poop|🤡 clown|👻 ghost boo|👽 alien|🤖 robot bot|😺 cat smile|😹 cat joy|😻 cat love|🙈 see no evil monkey|🙉 hear no evil|🙊 speak no evil';

const PEOPLE = '👋 wave hi hello bye|🤚 raised back hand|✋ hand stop high five|🖖 vulcan|👌 ok perfect|🤌 pinched fingers|🤏 pinch small|✌️ victory peace|🤞 fingers crossed luck|🫰 heart fingers|🤟 love you|🤘 rock horns|🤙 call me shaka|👈 point left|👉 point right|👆 point up|👇 point down|☝️ index up|👍 thumbs up yes like|👎 thumbs down no dislike|✊ fist|👊 punch fist bump|🤛 left fist|🤜 right fist|👏 clap applause bravo|🙌 raise hands hooray|🫶 heart hands|👐 open hands|🤲 palms up|🤝 handshake deal|🙏 pray please thanks|✍️ write|💪 strong muscle flex|🦾 mechanical arm|🧠 brain smart|👀 eyes look|👁️ eye|👅 tongue|👄 lips|🫡 salute|🫠 melting|🫢 gasp|🫣 peek|🤷 shrug dunno|🤦 facepalm|🙋 raise hand|🙆 ok gesture|🙅 no gesture|💁 tipping hand|🙇 bow sorry|🧑‍💻 coder developer|🥷 ninja|🧙 wizard mage|🦸 hero super|🧛 vampire|🧟 zombie|👑 crown king queen|🎩 top hat|🕶️ sunglasses';

const HEARTS = '❤️ red heart love|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🖤 black heart|🤍 white heart|🤎 brown heart|💔 broken heart|❤️‍🔥 heart on fire|💕 two hearts|💞 revolving hearts|💓 beating heart|💗 growing heart|💖 sparkling heart|💘 cupid arrow|💝 heart gift|💟 heart decoration|💋 kiss mark|💯 hundred perfect|💢 anger|💥 boom collision|💫 dizzy stars|💦 sweat drops|💨 dash fast|🕊️ dove peace|💬 speech chat|💭 thought|🗯️ anger bubble|💤 zzz sleep';

const PLAY = '🎲 dice die roll ludo|♟️ chess pawn|🃏 joker card|🀄 mahjong|🎴 flower cards|♠️ spade|♥️ heart suit|♦️ diamond suit|♣️ club suit|🎯 target bullseye dart|🎮 gamepad controller game|🕹️ joystick arcade|🎰 slot machine jackpot|🧩 puzzle piece|🏆 trophy win champion|🥇 gold first medal|🥈 silver second|🥉 bronze third|🏅 medal|🎖️ military medal|🎉 party popper tada celebrate|🎊 confetti|🎈 balloon|🎁 gift present|🎂 cake birthday|🔥 fire lit hot|✨ sparkles magic|⭐ star|🌟 glowing star|⚡ lightning zap|💣 bomb|🧨 firecracker|🎵 note music|🎶 notes music|🎤 mic sing|🎧 headphones|🥁 drum|🎸 guitar|🏁 checkered flag finish race|🚩 red flag|⚽ soccer football|🏀 basketball|🏈 american football|⚾ baseball|🎾 tennis|🏐 volleyball|🏓 ping pong|🥊 boxing glove|🥋 martial arts|⛳ golf|🎳 bowling|🏋️ weight lift|🚴 bike|🏊 swim';

const NATURE = '🐶 dog puppy|🐱 cat kitten|🐭 mouse|🐹 hamster|🐰 rabbit bunny|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🐔 chicken|🐧 penguin|🐦 bird|🦅 eagle|🦉 owl|🦄 unicorn|🐝 bee|🦋 butterfly|🐌 snail|🐢 turtle slow|🐍 snake|🐙 octopus|🦈 shark|🐬 dolphin|🐳 whale|🐊 crocodile|🐘 elephant|🦒 giraffe|🐎 horse|🐈 cat|🐕 dog|🌵 cactus|🌲 tree|🌴 palm|🍀 clover luck|🌿 herb|🍁 maple leaf|🌸 cherry blossom|🌹 rose|🌻 sunflower|🌷 tulip|🌞 sun|🌙 moon night|☁️ cloud|🌧️ rain|⛈️ storm|❄️ snow cold|🌈 rainbow|🌊 wave sea|🌋 volcano|🌍 earth world';

const FOOD = '🍏 green apple|🍎 apple|🍊 orange|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🍒 cherries|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥝 kiwi|🍅 tomato|🥑 avocado|🍆 eggplant|🥕 carrot|🌽 corn|🌶️ pepper hot|🥒 cucumber|🥔 potato|🧄 garlic|🧅 onion|🥐 croissant|🍞 bread|🧀 cheese|🥚 egg|🍳 cooking|🥞 pancakes|🥓 bacon|🍗 chicken leg|🍖 meat|🍔 burger|🍟 fries|🍕 pizza|🌭 hot dog|🌮 taco|🌯 burrito|🥗 salad|🍝 pasta|🍜 noodles ramen|🍣 sushi|🍚 rice|🍛 curry|🍦 ice cream|🍩 donut|🍪 cookie|🍫 chocolate|🍬 candy|🍭 lollipop|🍯 honey|☕ coffee|🍵 tea chai|🧃 juice|🥤 soda|🧋 bubble tea|🍷 wine|🍺 beer|🥂 cheers toast|🍿 popcorn';

const OBJECTS = '⌚ watch|📱 phone mobile|💻 laptop|⌨️ keyboard|🖥️ desktop|🖱️ mouse|💾 save disk|📷 camera|🎥 movie camera|📺 tv|📻 radio|⏰ alarm clock|⏳ hourglass waiting|⌛ time up|💡 idea bulb|🔦 flashlight|🕯️ candle|💰 money bag|💵 dollar cash|💎 gem diamond|🔧 wrench fix|🔨 hammer|🛠️ tools|⚙️ gear settings|🔗 link|🔒 lock locked secure|🔓 unlocked|🔑 key|🗝️ old key|🛡️ shield|⚔️ swords battle|🏹 bow arrow|🔮 crystal ball|🧿 nazar evil eye|📌 pin|📍 location pin|📎 paperclip|✂️ scissors|📝 memo note|📚 books|📖 book read|🔍 search magnifier|🔔 bell notification|🔕 bell off mute|📣 megaphone|📢 loudspeaker|✉️ envelope mail|📦 package box|🏠 house home|🚀 rocket launch|✈️ plane|🚗 car|🏍️ motorcycle|⛵ boat|🗺️ map|🧭 compass|⏱️ stopwatch timer';

const SYMBOLS = '✅ check done yes|☑️ ballot check|✔️ check mark|❌ cross no wrong|❎ cross box|➕ plus|➖ minus|➗ divide|✖️ multiply|❓ question|❔ white question|❗ exclamation|‼️ double exclamation|⁉️ interrobang|⚠️ warning|🚫 prohibited no|⛔ no entry|🔞 eighteen|♻️ recycle|🔄 repeat again|🔁 loop|⏩ fast forward|⏪ rewind|⏸️ pause|▶️ play|⏹️ stop|🔀 shuffle|🆗 ok button|🆕 new|🆒 cool|🆓 free|🆙 up|🔝 top|🔜 soon|🔙 back|💲 dollar sign|💱 exchange|™️ trademark|©️ copyright|🔴 red circle|🟠 orange circle|🟡 yellow circle|🟢 green circle|🔵 blue circle|🟣 purple circle|⚫ black circle|⚪ white circle|🟥 red square|🟩 green square|🟦 blue square|🟨 yellow square|🔺 up triangle|🔻 down triangle|💠 diamond dot|🔷 blue diamond|🔶 orange diamond|0️⃣ zero|1️⃣ one|2️⃣ two|3️⃣ three|4️⃣ four|5️⃣ five|6️⃣ six|7️⃣ seven|8️⃣ eight|9️⃣ nine|🔟 ten';

const FLAGS = '🇮🇷 iran|🇦🇫 afghanistan|🇹🇯 tajikistan|🇹🇷 turkey|🇦🇪 emirates uae|🇸🇦 saudi|🇮🇶 iraq|🇦🇿 azerbaijan|🇦🇲 armenia|🇬🇪 georgia|🇵🇰 pakistan|🇮🇳 india|🇨🇳 china|🇯🇵 japan|🇰🇷 korea|🇷🇺 russia|🇺🇦 ukraine|🇩🇪 germany|🇫🇷 france|🇬🇧 uk britain|🇮🇹 italy|🇪🇸 spain|🇳🇱 netherlands|🇸🇪 sweden|🇳🇴 norway|🇨🇦 canada|🇺🇸 usa america|🇧🇷 brazil|🇦🇷 argentina|🇲🇽 mexico|🇦🇺 australia|🇪🇬 egypt|🇳🇬 nigeria|🇿🇦 south africa|🏳️ white flag|🏴 black flag|🏳️‍🌈 rainbow flag';

const parse = (source: string): readonly Emoji[] => source.split('|').map((entry) =>
{
    const space = entry.indexOf(' ');

    return { char: entry.slice(0, space), words: entry.slice(space + 1) };
});

export const EMOJI_GROUPS: readonly { id: EmojiGroup; emoji: readonly Emoji[] }[] = [
    { id: 'smileys', emoji: parse(SMILEYS) },
    { id: 'people', emoji: parse(PEOPLE) },
    { id: 'hearts', emoji: parse(HEARTS) },
    { id: 'play', emoji: parse(PLAY) },
    { id: 'nature', emoji: parse(NATURE) },
    { id: 'food', emoji: parse(FOOD) },
    { id: 'objects', emoji: parse(OBJECTS) },
    { id: 'symbols', emoji: parse(SYMBOLS) },
    { id: 'flags', emoji: parse(FLAGS) }
];

export const QUICK_REACTIONS: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export function searchEmoji(query: string): readonly Emoji[]
{
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (terms.length === 0)
    {
        return [];
    }

    const seen = new Set<string>();

    return EMOJI_GROUPS.flatMap((group) => group.emoji).filter((emoji) =>
    {
        if (seen.has(emoji.char) || !terms.every((term) => emoji.words.split(' ').some((word) => word.startsWith(term))))
        {
            return false;
        }
        seen.add(emoji.char);
        return true;
    });
}
