import type BabelCore from '@babel/core'
import type {
  ForStatement,
  WhileStatement,
  DoWhileStatement,
  IfStatement,
  Identifier,
  VariableDeclaration,
  FunctionExpression
} from '@babel/types'

type Babel = typeof BabelCore
type Types = typeof BabelCore.types
type Plugin = BabelCore.PluginObj

export type AutoBreakOptions = BabelCore.PluginOptions & {
  onBreak?: string | ((line: number, column: number) => unknown)
  timeout?: number
}

type Loop = BabelCore.NodePath<ForStatement | WhileStatement | DoWhileStatement>

export default function autoBreak(babel: Babel, options: AutoBreakOptions = {}): Plugin {

  const { types: t, transform } = babel
  const { timeout = 2000, onBreak = noop } = options

  const onAutoBreak = transformOnBreak({ t, transform, onBreak })

  return {
    visitor: {
      ForStatement: breakAfter,
      WhileStatement: breakAfter,
      DoWhileStatement: breakAfter
    }
  }

  function breakAfter(loop: Loop): void {

    const { line, column } = { line: 0, column: 0, ...loop.node.loc?.start }
    const id = loop.scope.generateUidIdentifier('auto_break_start')

    loop.insertBefore(generateInitialization({ t, id }))

    const loopBody = loop.get('body')
    const loopGuard = generateLoopGuard({ t, id, line, column, timeout, onAutoBreak })

    if (!loopBody.isBlockStatement()) {
      loopBody.replaceWith(t.blockStatement([loopGuard, loopBody.node]))
    } else {
      loopBody.unshiftContainer('body', loopGuard)
    }
  }
}

type TransformOnBreakParams = {
  t: Types
  transform: Babel['transform']
  onBreak: string | ((line: number, column: number) => void)
}

function transformOnBreak({ t, transform, onBreak }: TransformOnBreakParams): FunctionExpression {

  const onAutoBreakCode = typeof onBreak === 'function'
    ? onBreak.toString().replace(/^function\s*\(/, 'function $onAutoBreak$(')
    : `() => console.error("${String(onBreak).replace(/"/g, '\\"')}")`

  const onAutoBreak = transform(onAutoBreakCode, { ast: true })?.ast?.program.body[0]

  if (t.isExpressionStatement(onAutoBreak)) {
    // ArrowFunctionExpression
    return onAutoBreak.expression as FunctionExpression
  }

  if (t.isFunctionDeclaration(onAutoBreak)) {
    return t.functionExpression(onAutoBreak.id, onAutoBreak.params, onAutoBreak.body)
  }

  /* c8 ignore next */
  throw new Error('babel-babel-auto-break: invalid onBreak action') // unreachable
}

const noop = function (): void { }

type InitializationParams = {
  t: Types
  id: Identifier
}

function generateInitialization({ t, id }: InitializationParams): VariableDeclaration {
  return (
    t.variableDeclaration('var', [
      t.variableDeclarator(
        id,
        t.callExpression(
          t.memberExpression(t.identifier('Date'), t.identifier('now')),
          []
        )
      )
    ])
  )
}

type LoopGuardParams = {
  t: Types
  id: Identifier
  line: number
  column: number
  timeout: number
  onAutoBreak: FunctionExpression
}

function generateLoopGuard(
  { t, id, line, column, timeout, onAutoBreak }: LoopGuardParams
): IfStatement {
  return (
    t.ifStatement(
      t.binaryExpression(
        '>',
        t.binaryExpression(
          '-',
          t.callExpression(
            t.memberExpression(
              t.identifier('Date'),
              t.identifier('now')
            ),
            []
          ),
          id
        ),
        t.numericLiteral(timeout)
      ),
      t.blockStatement([
        t.expressionStatement(
          t.callExpression(onAutoBreak, [
            t.numericLiteral(line),
            t.numericLiteral(column)
          ])
        ),
        t.breakStatement()
      ])
    )
  )
}
