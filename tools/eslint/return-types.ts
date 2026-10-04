import type { AST, Rule, Scope, SourceCode } from 'eslint';
import ts from 'typescript';

type Tree = Record<string, unknown> & { type: string; parent: Tree };

interface Callable extends Tree
{
    async: boolean;
    generator: boolean;
    body: Tree | null;
    returnType?: { range: AST.Range; loc: AST.SourceLocation; typeAnnotation: Tree };
}

interface Typed
{
    program: ts.Program | null;
    esTreeNodeToTSNodeMap: { get(node: unknown): ts.Node | undefined };
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const THROUGH: Record<string, string[]> = {
    ConditionalExpression: ['consequent', 'alternate'],
    LogicalExpression: ['left', 'right'],
    AwaitExpression: ['argument'],
    TSNonNullExpression: ['expression'],
    ChainExpression: ['expression']
};

const PLAIN = new Set([
    'Identifier', 'MemberExpression', 'BinaryExpression', 'UnaryExpression', 'UpdateExpression', 'AssignmentExpression',
    'TemplateLiteral', 'Literal', 'TSAsExpression', 'TSSatisfiesExpression'
]);

const READ = new Set(['Identifier', 'MemberExpression', 'CallExpression', 'NewExpression']);

const UNIT = ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.BooleanLiteral
    | ts.TypeFlags.EnumLiteral | ts.TypeFlags.UniqueESSymbol | ts.TypeFlags.Null | ts.TypeFlags.Undefined;

const PRINT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType;

const isTree = (value: unknown): value is Tree =>
    typeof value === 'object' && value !== null && typeof (value as Tree).type === 'string';

const childrenOf = (node: Tree, keys: SourceCode.VisitorKeys): Tree[] =>
    (keys[node.type] ?? []).flatMap((key) => [node[key]].flat().filter(isTree));

const returnsOf = (node: Tree, keys: SourceCode.VisitorKeys): (Tree | null)[] =>
{
    if (node.type === 'ReturnStatement')
    {
        return [node.argument as Tree | null];
    }
    return FUNCTIONS.has(node.type) ? [] : childrenOf(node, keys).flatMap((child) => returnsOf(child, keys));
};

const isVoid = (type: Tree): boolean => type.type === 'TSVoidKeyword';

const saysNothing = (fn: Callable): boolean =>
{
    const said = fn.returnType!.typeAnnotation;
    if (!fn.async)
    {
        return isVoid(said);
    }
    const inner = (said.typeArguments as { params: Tree[] } | undefined)?.params ?? [];
    return said.type === 'TSTypeReference' && (said.typeName as Tree).name === 'Promise' && inner.length === 1 && isVoid(inner[0]!);
};

const neverWhenItCannotEnd = (fn: Callable): boolean =>
    fn.type !== 'FunctionDeclaration' && fn.parent.type !== 'MethodDefinition';

const isLiteral = (node: Tree): boolean =>
    node.type === 'Literal'
    || (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0)
    || (node.type === 'UnaryExpression' && node.operator === '-' && (node.argument as Tree).type === 'Literal');

const isDecorated = (node: Tree): boolean => ((node.decorators as unknown[] | undefined)?.length ?? 0) > 0;

const prefersInferredReturnType: Rule.RuleModule = {
    meta: {
        type: 'suggestion',
        fixable: 'code',
        schema: [],
        messages: {
            redundant: 'The compiler already infers `{{ said }}` here. Remove the annotation.'
        }
    },

    create(context)
    {
        const source = context.sourceCode;
        const keys = source.visitorKeys;
        const typed = source.parserServices as Typed | undefined;
        const checker = typed?.program?.getTypeChecker();

        const tsOf = (node: Tree): ts.Node | undefined => typed!.esTreeNodeToTSNodeMap.get(node);

        const typeOf = (node: Tree): ts.Type => checker!.getTypeAtLocation(tsOf(node)!);

        const functionOf = (variable: Scope.Variable): Tree | undefined =>
        {
            const [def] = variable.defs;
            if (def?.type !== 'FunctionName' && def?.type !== 'Variable')
            {
                return undefined;
            }
            const node = def.node as unknown as Tree;
            const made = node.type === 'VariableDeclarator' ? node.init as Tree | null : node;
            return made !== null && FUNCTIONS.has(made.type) ? made : undefined;
        };

        const called = (scope: Scope.Scope): Tree[] => [
            ...scope.references.flatMap((one) => one.resolved === null ? [] : functionOf(one.resolved) ?? []),
            ...scope.childScopes.flatMap(called)
        ];

        const reaches = (from: Tree, target: Tree, seen: Set<Tree>): boolean =>
            called(source.getScope(from as unknown as Rule.Node)).some((next) =>
                next === target || (!seen.has(next) && reaches(next, target, seen.add(next))));

        const namesItself = (fn: Callable): boolean =>
        {
            const key = (fn.parent.type === 'MethodDefinition' || fn.parent.type === 'Property' || fn.parent.type === 'PropertyDefinition')
                ? (fn.parent.key as Tree).name
                : undefined;
            const mentions = (node: Tree): boolean =>
                (node.type === 'MemberExpression' && (node.property as Tree).name === key) || childrenOf(node, keys).some(mentions);

            return reaches(fn, fn, new Set()) || (key !== undefined && mentions(fn.body!));
        };

        const isGeneric = (call: Tree): boolean =>
        {
            const declared = checker!.getResolvedSignature(tsOf(call) as ts.CallLikeExpression)?.getDeclaration();
            return declared === undefined
                || declared.typeParameters !== undefined
                || (ts.isConstructorDeclaration(declared) && declared.parent.typeParameters !== undefined);
        };

        const standsAlone = (node: Tree): boolean =>
        {
            const through = THROUGH[node.type];
            if (through !== undefined)
            {
                return through.every((key) => standsAlone(node[key] as Tree));
            }
            if (node.type === 'CallExpression' || node.type === 'NewExpression')
            {
                return (node.typeArguments !== undefined && node.typeArguments !== null) || !isGeneric(node);
            }
            return PLAIN.has(node.type);
        };

        const readsAny = (node: Tree): boolean =>
            (READ.has(node.type) && tsOf(node) !== undefined && (typeOf(node).flags & ts.TypeFlags.Any) !== 0) || childrenOf(node, keys).some(readsAny);

        const hasOverloads = (fn: Callable): boolean =>
        {
            const name = (tsOf(fn) as ts.FunctionLikeDeclaration).name;
            return name !== undefined && (checker!.getSymbolAtLocation(name)?.declarations?.length ?? 1) > 1;
        };

        const infersTheSame = (fn: Callable): boolean =>
        {
            const said = fn.returnType!.typeAnnotation;
            const owner = fn.parent;
            const returned = (fn.body!.type === 'BlockStatement' ? returnsOf(fn.body!, keys) : [fn.body]).filter((one) => one !== null);

            if (checker === undefined || fn.generator || returned.length === 0 || said.type === 'TSTypePredicate')
            {
                return false;
            }
            if ((owner.type === 'MethodDefinition' && (isDecorated(owner) || (fn.params as Tree[]).some(isDecorated))) || hasOverloads(fn))
            {
                return false;
            }
            if (!returned.every((one) => standsAlone(one) && !readsAny(one)) || namesItself(fn))
            {
                return false;
            }

            const at = tsOf(fn);
            const declared = checker.getTypeFromTypeNode(tsOf(said) as ts.TypeNode);
            const target = fn.async ? checker.getAwaitedType(declared) : declared;

            if (target === undefined || (target.flags & ts.TypeFlags.Any) !== 0)
            {
                return false;
            }

            const hasVoid = (target.isUnion() ? target.types : [target]).some((one) => (one.flags & ts.TypeFlags.Void) !== 0);
            if (hasVoid && fn.body!.type === 'BlockStatement')
            {
                return false;
            }

            const print = (type: ts.Type): string => checker.typeToString(type, at, PRINT);
            const same = (type: ts.Type | undefined): boolean =>
                type !== undefined && print(type) === print(target) && checker.isTypeAssignableTo(type, target) && checker.isTypeAssignableTo(target, type);
            const settled = (node: Tree): ts.Type | undefined => fn.async ? checker.getAwaitedType(typeOf(node)) : typeOf(node);

            const literals = returned.filter(isLiteral);
            const others = returned.filter((one) => !isLiteral(one));

            if (others.some((one) => ((settled(one)?.flags ?? 0) & UNIT) !== 0) || !others.every((one) => same(settled(one))))
            {
                return false;
            }
            if (literals.length === 0)
            {
                return true;
            }

            const unbound = fn.type === 'FunctionDeclaration'
                || owner.type === 'MethodDefinition'
                || (owner.type === 'VariableDeclarator' && (owner.id as Tree).typeAnnotation === undefined);
            const values = new Set(literals.map((one) => typeof one.value === 'boolean' ? 'boolean' : source.getText(one as unknown as Rule.Node)));

            return unbound
                && (others.length > 0 || values.size === 1)
                && literals.every((one) => same(checker.getBaseTypeOfLiteralType(settled(one) ?? typeOf(one))));
        };

        const returnsNothing = (fn: Callable, path: Rule.CodePath): boolean =>
            fn.body!.type === 'BlockStatement'
            && !fn.generator
            && saysNothing(fn)
            && returnsOf(fn.body!, keys).every((one) => one === null)
            && !(neverWhenItCannotEnd(fn) && !path.returnedSegments.some((segment) => segment.reachable));

        return {
            onCodePathEnd(path, node)
            {
                const fn = node as unknown as Callable;

                if (!FUNCTIONS.has(fn.type) || fn.returnType === undefined || fn.body === null)
                {
                    return;
                }
                if (!returnsNothing(fn, path) && !infersTheSame(fn))
                {
                    return;
                }

                const said = fn.returnType;
                const before = source.getTokenBefore(said as unknown as AST.Token);

                context.report({
                    loc: said.loc,
                    messageId: 'redundant',
                    data: { said: source.getText(said.typeAnnotation as unknown as Rule.Node) },
                    fix: (fixer) => fixer.removeRange([before === null ? said.range[0] : before.range[1], said.range[1]])
                });
            }
        };
    }
};

export const nura = {
    meta: { name: 'nura' },
    rules: {
        'prefer-inferred-return-type': prefersInferredReturnType
    }
};
