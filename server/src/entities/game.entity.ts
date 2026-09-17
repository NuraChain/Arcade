import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Whether a game can be entered.
 *
 * The point of holding this server-side is that a game ships without a client release: the
 * catalogue page renders whatever the server publishes, so `coming-soon` is a row edit rather
 * than a deploy. Four rule engines do not exist yet, which is exactly the state this models.
 */
export type GameStatus = 'available' | 'coming-soon' | 'disabled';

/**
 * A game, as the PRODUCT defines it.
 *
 * Deliberately NOT here: `anchor`, `rotation`, `table`, `set`, `accent`. Those are scene geometry
 * for the 3D market on the landing page, they change only when a Blender script changes, and the
 * landing route is `render: 'static'` — it must paint with no JavaScript and no server. They stay
 * in `application/src/data/games.ts`, and the client merges the two by id.
 *
 * There is deliberately no inverse `rule` property. Game and GameRule reference each other, and a
 * pair of entity modules that import each other is a TDZ error the moment TypeORM loads them
 * ("Cannot access 'GameRule' before initialization") — the relation thunks are lazy, the ES module
 * graph is not. GameRule owns the single direction, and anything needing both joins explicitly.
 *
 * Names and blurbs are message KEYS, not prose. The catalogue is reference content that must
 * follow a language switch live, and the app already owns both catalogues under
 * `application/src/locales/{en,fa}/`, where a key missing from Persian is a build error.
 */
@Check('games_category_known', `category in ('cards', 'board')`)
@Check('games_players_sane', `min_players between 1 and 16 and max_players between min_players and 16`)
@Check('games_status_known', `status in ('available', 'coming-soon', 'disabled')`)
@Index('games_sort_order_idx', ['sortOrder'])
@Entity('games')
export class Game
{
    /** The stable identity the whole product keys on: 'hokm', 'poker', 'backgammon', 'ludo'. */
    @PrimaryColumn({ type: 'varchar', length: 32 })
    id!: string;

    /** What appears in a url. Separate from `id` so a game can be renamed without breaking links. */
    @Column({ type: 'varchar', length: 64, unique: true })
    slug!: string;

    @Column({ name: 'name_key', type: 'varchar', length: 128 })
    nameKey!: string;

    @Column({ name: 'blurb_key', type: 'varchar', length: 128 })
    blurbKey!: string;

    @Column({ name: 'category_key', type: 'varchar', length: 128 })
    categoryKey!: string;

    @Column({ type: 'varchar', length: 16 })
    category!: string;

    @Column({ name: 'min_players', type: 'smallint' })
    minPlayers!: number;

    @Column({ name: 'max_players', type: 'smallint' })
    maxPlayers!: number;

    @Column({ type: 'varchar', length: 16, default: 'available' })
    status!: GameStatus;

    /** Display order. Explicit, because "the order they were inserted" is not an order. */
    @Column({ name: 'sort_order', type: 'smallint' })
    sortOrder!: number;
}
