import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import { resolve } from 'node:path';
import ts from 'typescript';
import tseslint from 'typescript-eslint';

import { nura } from '../../tools/eslint/return-types.ts';

const FILE = resolve('sample.ts');

const OPTIONS: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    experimentalDecorators: true
};

const linter = new Linter();
const host = ts.createCompilerHost(OPTIONS);
const fromDisk = host.getSourceFile.bind(host);
const onDisk = host.fileExists.bind(host);
const libraries = new Map<string, ts.SourceFile | undefined>();

let sample = '';

host.fileExists = (name) => resolve(name) === FILE || onDisk(name);

host.getSourceFile = (name, version) =>
{
    if (resolve(name) === FILE)
    {
        return ts.createSourceFile(name, sample, version, true);
    }
    if (!libraries.has(name))
    {
        libraries.set(name, fromDisk(name, version));
    }
    return libraries.get(name);
};

const compile = (code: string) =>
{
    sample = code;
    return ts.createProgram([FILE], OPTIONS, host);
};

const lint = (code: string, program?: ts.Program): Linter.LintMessage[] => linter.verify(code, [{
    files: ['**/*.ts'],
    languageOptions: {
        parser: tseslint.parser as Linter.Parser,
        parserOptions: program === undefined ? {} : { programs: [program] }
    },
    plugins: { nura },
    rules: { 'nura/prefer-inferred-return-type': 'error' }
}], { filename: FILE });

const without = (code: string, messages: Linter.LintMessage[]): string =>
    [...messages].sort((a, b) => b.fix!.range[0] - a.fix!.range[0])
        .reduce((text, one) => text.slice(0, one.fix!.range[0]) + one.fix!.text + text.slice(one.fix!.range[1]), code);

const fixed = (code: string) => without(code, lint(code));

const nameOn = (line: string) => /\b(?:drop|keep)\w+/.exec(line)?.[0] ?? '';

const SAMPLE = [
    'interface Row { id: string; name: string }',
    'declare const rows: Map<string, Row>;',
    'declare const loose: any;',
    'declare function load(id: string): Row;',
    'declare function pick<T>(): T;',
    'declare function nothing(): void;',
    'declare function later(): Promise<void>;',
    'declare function log(target: object, key: string): void;',
    'const dropCall = (id: string): Row => load(id);',
    'const dropTemplate = (id: string): string => `row ${ id }`;',
    'const dropCompare = (a: number, b: number): boolean => a > b;',
    'function dropLiteral(): number { return 1; }',
    'function dropBooleans(a: number): boolean { if (a > 1) { return true; } return false; }',
    'function dropAbsorbed(a: string): string { if (a === "") { return "none"; } return a.trim(); }',
    'const dropAsync = async (id: string): Promise<Row> => load(id);',
    'const dropLookup = (id: string): Row | undefined => rows.get(id);',
    'const dropVoidCall = (): void => nothing();',
    'const dropCast = (id: string): Row => ({ id, name: id }) as Row;',
    'const dropTable = (): Row => table.first;',
    'const table = { first: load("a") };',
    'const dropTyped = (): Row => typed.row;',
    'const typed: { row: Row } = { row: dropTyped() };',
    'class Entity {',
    '    public name = "";',
    '    public dropMethod(): string { return this.name; }',
    '    @log public keepDecorated(): string { return this.name; }',
    '    public keepSelfCall(depth: number): number { return depth < 1 ? 0 : this.keepSelfCall(depth - 1) + 1; }',
    '}',
    'const keepObject = (id: string): Row => ({ id, name: id });',
    'const keepArray = (id: string): string[] => [id];',
    'const keepSet = (): Set<string> => new Set();',
    'const keepGeneric = (): Row => pick();',
    'const keepArrow = (): ((id: string) => Row) => (id) => load(id);',
    'const keepChoice = (a: boolean): string => a ? "x" : "y";',
    'const keepNarrow = (): "a" | "b" => "a";',
    'const keepWider = (id: string): Row | undefined => load(id);',
    'const keepConstant = (): number => { const one = 1; return one; };',
    'const keepAny = (): string => loose.name;',
    'const keepVoidOperator = (): void => void nothing();',
    'const keepVoidBlock = async (flag: boolean): Promise<void> => { if (flag) { return later(); } };',
    'function keepRecursive(depth: number): number { return depth < 1 ? 0 : depth + keepRecursive(depth - 1); }',
    'const keepMutualA = (depth: number): number => depth < 1 ? 0 : keepMutualB(depth);',
    'const keepMutualB = (depth: number): number => keepMutualA(depth - 1);',
    'const keepHeld = (): Row => held.row;',
    'const held = { row: keepHeld() };',
    'const keepNested = (): Row => load(nest.rows.map((one) => one.id).join(""));',
    'const nest = { rows: [keepNested()] };',
    'const keepLazy = (): Row => lazy.make();',
    'const lazy = { make: () => keepLazy() };',
    'function keepPredicate(value: unknown): value is string { return typeof value === "string"; }',
    'function keepOverload(value: string): string;',
    'function keepOverload(value: number): string;',
    'function keepOverload(value: string | number): string { return String(value); }',
    'function* keepGenerator(): Generator<number, string> { yield 1; return "done"; }',
    'export { dropCall, dropTemplate, dropCompare, dropLiteral, dropBooleans, dropAbsorbed, dropAsync, dropLookup, dropVoidCall, dropCast, Entity };',
    'export { keepObject, keepArray, keepSet, keepGeneric, keepArrow, keepChoice, keepNarrow, keepWider, keepConstant, keepAny, keepVoidOperator, keepVoidBlock };',
    'export { keepRecursive, keepMutualA, keepMutualB, keepPredicate, keepOverload, keepGenerator };',
    'export { dropTable, dropTyped, keepHeld, keepNested, keepLazy };'
].join('\n');

const returnTypes = (program: ts.Program) =>
{
    const checker = program.getTypeChecker();
    const seen: string[] = [];

    const visit = (node: ts.Node) =>
    {
        if (ts.isFunctionLike(node) && 'body' in node && node.body !== undefined)
        {
            seen.push(checker.typeToString(checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(node)!), node, ts.TypeFormatFlags.NoTruncation));
        }
        ts.forEachChild(node, visit);
    };

    visit(program.getSourceFile(FILE)!);
    return seen;
};

describe('a function that returns nothing', () =>
{
    it('loses the void the compiler already infers, with no type information at all', () =>
    {
        expect(fixed('const a = (): void => { work(); };')).toBe('const a = () => { work(); };');
        expect(fixed('function a(x: number): void { if (x) { return; } work(); }')).toBe('function a(x: number) { if (x) { return; } work(); }');
        expect(fixed('const a = async (id: string): Promise<void> => { await work(id); };')).toBe('const a = async (id: string) => { await work(id); };');
        expect(fixed('const o = { run(): void { work(); } };')).toBe('const o = { run() { work(); } };');
        expect(fixed('const a = (): void => { const b = (): number => 1; b(); };')).toBe('const a = () => { const b = (): number => 1; b(); };');
    });

    it('keeps it where the compiler would infer never instead: an arrow or an object method that cannot end', () =>
    {
        for (const code of [
            'const a = (): void => { throw new Error("x"); };',
            'const a = (): void => { while (true) { work(); } };',
            'const o = { run(): void { throw new Error("x"); } };'
        ])
        {
            expect(fixed(code)).toBe(code);
        }

        expect(fixed('function a(): void { throw new Error("x"); }')).toBe('function a() { throw new Error("x"); }');
        expect(fixed('class A { public run(): void { throw new Error("x"); } }')).toBe('class A { public run() { throw new Error("x"); } }');
    });

    it('never touches a signature with no body, where the annotation is the only statement of the type', () =>
    {
        for (const code of [
            'interface A { run(): void; close: () => void; }',
            'declare function a(): void;',
            'abstract class A { public abstract run(): void; }'
        ])
        {
            expect(fixed(code)).toBe(code);
        }
    });
});

describe('a function that returns a value', () =>
{
    const program = compile(SAMPLE);
    const messages = lint(SAMPLE, program);
    const lines = SAMPLE.split('\n');

    it('is a sample the compiler accepts, so every answer below is about types and not about errors', () =>
    {
        expect(ts.getPreEmitDiagnostics(program).map((one) => ts.flattenDiagnosticMessageText(one.messageText, ' '))).toEqual([]);
    });

    it('loses its annotation exactly where every return already has that type by itself', () =>
    {
        const dropped = messages.map((one) => nameOn(lines[one.line - 1]!));
        const expected = lines.map(nameOn).filter((name, index, all) => name.startsWith('drop') && all.indexOf(name) === index);

        expect(dropped).toEqual(expected);
    });

    it('is left alone without type information, because nothing can be proved from the text', () =>
    {
        expect(lint(SAMPLE)).toEqual([]);
    });

    it('has the same type after the fix as before it, for every function in the sample', () =>
    {
        const after = compile(without(SAMPLE, messages));

        expect(ts.getPreEmitDiagnostics(after)).toEqual([]);
        expect(returnTypes(after)).toEqual(returnTypes(program));
    });

    it('keeps the one a constant leads back to, because without it the compiler can say neither type', () =>
    {
        for (const name of ['keepHeld', 'keepNested', 'keepLazy'])
        {
            const bare = SAMPLE.replace(`const ${ name } = (): Row =>`, `const ${ name } = () =>`);
            const said = ts.getPreEmitDiagnostics(compile(bare)).map((one) => ts.flattenDiagnosticMessageText(one.messageText, ' '));

            expect(bare).not.toBe(SAMPLE);
            expect(said.filter((one) => one.includes(`'${ name }' implicitly has return type 'any'`))).toHaveLength(1);
        }
    });
});
