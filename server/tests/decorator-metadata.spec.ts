import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import { Column, Entity, PrimaryGeneratedColumn, getMetadataArgsStorage } from 'typeorm';

/**
 * The test runner transforms this workspace with oxc, not with tsc — a different compiler from
 * the one `azeroth build` uses. If oxc ever stops emitting `design:type`, a bare `@Column()`
 * would pass `check`, pass `build`, pass `dev`, and throw `ColumnTypeUndefinedError` only here,
 * which reads like a broken test runner and is not one.
 *
 * So the assumption is pinned rather than trusted.
 */

@Entity('decorator_probe')
class Probe
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column()
    plain!: string;

    @Column({ type: 'int' })
    explicit!: number;
}

describe('decorator metadata under the test transform', () =>
{
    it('registers the entity and both columns with TypeORM', () =>
    {
        const storage = getMetadataArgsStorage();
        const table = storage.tables.find((entry) => entry.target === Probe);
        expect(table?.name).toBe('decorator_probe');

        const columns = storage.columns.filter((entry) => entry.target === Probe).map((entry) => entry.propertyName);
        expect(columns).toContain('plain');
        expect(columns).toContain('explicit');
    });

    it('emits design:type, so a column without an explicit type still knows what it is', () =>
    {
        // This is the whole question. `emitDecoratorMetadata` is a TRANSFORM, not type erasure:
        // a compiler that only strips types cannot produce it.
        const reflected = Reflect.getMetadata('design:type', Probe.prototype, 'plain') as
            (new () => unknown) | undefined;

        expect(reflected).toBe(String);
    });

    it('keeps class fields as accessors, not [[Define]] installs', () =>
    {
        // useDefineForClassFields: true would install `undefined` over the prototype accessors
        // TypeORM attaches for relations - silent data corruption rather than a crash. A declared
        // field with no initializer must therefore leave no own property behind.
        const instance = new Probe();
        expect(Object.hasOwn(instance, 'plain')).toBe(false);
    });
});
