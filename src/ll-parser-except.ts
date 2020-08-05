import { Lexer, TokenType, Token, EOF, SyntaxError } from './lexer-except'
import { Either, Right, Left } from './utils'
import { match } from 'assert'

export class Parser {
  lexer: Lexer

  constructor(source: string) {
    this.lexer = new Lexer(source)
  }

  parse(): Either<Expr[], string> {
    if (this.lexer.eof) {
      return new Right('eof')
    }

    let result: Expr[] = []

    while (true) {
      try {
        let res = parseExpr(this.lexer)
        result.push(res)
      } catch (e) {
        if (e instanceof EOF) {
          break
        } else if (e instanceof SyntaxError) {
          return new Right(e.toString())
        } else {
          throw e
        }
      }
    }

    return new Left(result)
  }
}

const UNEXP_EOF = 'syntax error: unexpected EOF'

type SyntaxHandler = (lexer: Lexer) => ExprLetVar | ExprLetFunc | ExprLambda | ExprDo | Macro

const macroReg: Map<string, Macro> = new Map()

// reserved identifiers
export const KEYWORD: {[keys: string]: SyntaxHandler | undefined} = {
  'let': parseLet,
  '\\': parseLambda,
  'do': parseDo,
  'macro': parseMacro,
}

export type Expr = number | string | Var | SExpr | ListExpr | DictExpr | ExprLetVar | ExprLetFunc | ExprLambda | ExprDo | Macro

function parseExpr(lexer: Lexer): Expr {
  if (lexer.eof) {
    throw new EOF()
  }

  let token = lexer.next().check()
  if (token.type === TokenType.number) {
    return parseFloat(token.literal)
  } else if (token.type === TokenType.string) {
    return token.literal.slice(1, token.literal.length - 1)
  } else if (token.type === TokenType.symbol) {
    switch (token.literal) {
      case '(':
        return parseSExpr(lexer)
      case '[':
        return parseListExpr(lexer)
      case '{':
        return parseDictExpr(lexer)
      default:
        throw new SyntaxError(`unexpected '${token.literal}'${token.locate()}`)
    }
  } else if (token.type === TokenType.identifier) {
    if (KEYWORD[token.literal] !== undefined) {
      throw new SyntaxError(`unexpected keyword ${token.literal}${token.locate()}`)
    } else {
      return new Var(token.literal, token.locate())
    }
  } else if (token.type === TokenType.err) {
    throw new SyntaxError(token.toString())
  } else if (token.type === TokenType.eof) {
    throw new EOF()
  } else {
    throw new Error(`unknown internal error: in parseExpr: ${token}`)
  }
}

export class Var {
  id: string
  location: string

  constructor(id: string, location: string) {
    this.id = id
    this.location = location
  }
}

export class SExpr {
  caller?: Expr
  args: Expr[]
  location: string

  constructor(items: Expr[], location: string) {
    if (items.length === 0) {
      this.caller = undefined
      this.args = []
    }
    this.caller = items[0]
    this.args = items.slice(1)
    this.location = location
  }

  get isUnit(): boolean {
    return this.caller === undefined
  }
}

function parseSExpr(lexer: Lexer): SExpr | ExprLetVar | ExprLetFunc | ExprLambda | ExprDo | Macro {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let location = ` at line ${lexer.line}, column ${lexer.column}`

  let items: Expr[] = []

  let token = lexer.lookNext().check()
  let handler = KEYWORD[token.literal]
  if (handler !== undefined) {
    lexer.next()
    return handler(lexer)
  }

  let macro = macroReg.get(token.literal)

  while (!(token.type === TokenType.symbol && token.literal === ')')) {
    let expr = parseExpr(lexer)

    items.push(expr)

    token = lexer.lookNext().check()
  }
  
  // cast off ')' symbol
  lexer.next()

  if (macro !== undefined) {
    return expandMacro(macro, items, location)
  } else {
    return new SExpr(items, location)
  }
}

export class ListExpr {
  items: Expr[]

  constructor(items: Expr[]) {
    this.items = items
  }
}

function parseListExpr(lexer: Lexer): ListExpr {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let result = new ListExpr([])
  let token = lexer.lookNext().check()
  while (!(token.type === TokenType.symbol && token.literal === ']')) {
    let expr = parseExpr(lexer)

    result.items.push(expr)

    token = lexer.lookNext().check()
  }

  // cast off ']' symbol
  lexer.next()

  return result
}

export class DictEntry {
  key: Expr
  value: Expr

  constructor(key: Expr, value: Expr) {
    this.key = key
    this.value = value
  }
}

function parseDictEntry(lexer: Lexer): DictEntry {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let key = parseExpr(lexer)
  let value = parseExpr(lexer)
  let token = lexer.next().check()
  if (token.type === TokenType.symbol && token.literal === ')') {
    return new DictEntry(key, value)
  } else {
    throw new SyntaxError(`expected ')'${token.locate()}`)
  }
}

export class DictExpr {
  entries: DictEntry[]

  constructor(entries: DictEntry[]) {
    this.entries = entries
  }
}

function parseDictExpr(lexer: Lexer): DictExpr {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let result = new DictExpr([])
  let token_ = lexer.lookNext().check()
  while (!(token_.type === TokenType.symbol && token_.literal === '}')) {
    let token = lexer.next().check()
    if (token.type === TokenType.symbol && token.literal === '(') {
      let entry = parseDictEntry(lexer)
      result.entries.push(entry)
    } else {
      throw new SyntaxError(`expected '('${token.locate()}`)
    }

    token_ = lexer.lookNext().check()
  }

  // cast off '}' symbol
  lexer.next()

  return result
}

export class ExprLetVar {
  id: string
  expr: Expr

  constructor(id: string, expr: Expr) {
    this.id = id
    this.expr = expr
  }
}

export class ExprLetFunc {
  id: string
  params: string[]
  body: Expr
  location: string

  constructor(id: string, params: string[], body: Expr, location: string) {
    this.id = id
    this.params = params
    this.body = body
    this.location = location
  }
}

function parseLet(lexer: Lexer): ExprLetVar | ExprLetFunc {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let token = lexer.next().check()
  if (token.type === TokenType.identifier) {
    if (KEYWORD[token.literal] !== undefined) {
      throw new SyntaxError(`unexpected keyword ${token.literal}${token.locate()}`)
    }
    return parseLetVar(lexer, token.literal)
  } else if (token.type === TokenType.symbol && token.literal === '(') {
    return parseLetFunc(lexer)
  } else {
    throw new SyntaxError(`expected IDENTIFIER or '('${token.locate()}`)
  }
}

function parseLetVar(lexer: Lexer, id: string): ExprLetVar {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let expr = parseExpr(lexer)

  let elv = new ExprLetVar(id, expr)

  let token = lexer.next().check()
  if (!(token.type === TokenType.symbol && token.literal === ')')) {
    throw new SyntaxError(`expected ')'${token.locate()}`)
  }

  return elv
}

function parseLetFunc(lexer: Lexer): ExprLetFunc {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let token = lexer.next().check()
  if (token.type === TokenType.identifier) {
    if (KEYWORD[token.literal] !== undefined) {
      throw new SyntaxError(`unexpected keyword ${token.literal}${token.locate()}`)
    } else {
      let id = token.literal
      let location = token.locate()
      let params: string[] = []

      let paren = lexer.saveParenCounter()
      paren.decParen()

      while (!paren.eq(lexer.parenCounter)) {
        if (lexer.eof) {
          throw new SyntaxError(UNEXP_EOF)
        }

        token = lexer.next().check()
        if (token.type === TokenType.symbol && token.literal === ')') {
          break
        } else if (token.type === TokenType.identifier) {
          if (KEYWORD[token.literal] !== undefined) {
            throw new SyntaxError(`unexpected keyword ${token.literal}${token.locate()}`)
          } else {
            params.push(token.literal)
          }
        } else {
          throw new SyntaxError(`expected IDENTIFIER${token.locate()}`)
        }
      }

      let body = parseExpr(lexer)

      token = lexer.next().check()
      if (!(token.type === TokenType.symbol && token.literal === ')')) {
        throw new SyntaxError(`expected ')'${token.locate()}`)
      }

      return new ExprLetFunc(id, params, body, location)
    }
  } else {
    throw new SyntaxError(`expected IDENTIFIER${token.locate()}`)
  }
}

export class ExprLambda {
  args: string[]
  body: Expr
  location: string

  constructor(args: string[], body: Expr, location: string) {
    this.args = args
    this.body = body
    this.location = location
  }
}

function parseLambda(lexer: Lexer): ExprLambda {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }
  let location = ` at line ${lexer.line}, column ${lexer.column}`

  let token = lexer.next().check()
  if (!(token.type === TokenType.symbol && token.literal === '(')) {
    throw new SyntaxError(`expected '('${token.locate()}`)
  }

  let paren = lexer.saveParenCounter()
  paren.decParen()
  let args: string[] = []
  while (!paren.eq(lexer.parenCounter)) {
    if (lexer.eof) {
      throw new SyntaxError(UNEXP_EOF)
    }

    token = lexer.next().check()
    if (token.type === TokenType.symbol && token.literal === ')') {
      break
    } else if (token.type === TokenType.identifier) {
      args.push(token.literal)
    } else {
      throw new SyntaxError(`expected IDENTIFIER${token.locate()}`)
    }
  }

  let body = parseExpr(lexer)

  token = lexer.next().check()
  if (!(token.type === TokenType.symbol && token.literal === ')')) {
    throw new SyntaxError(`expected ')'${token.locate()}`)
  }

  return new ExprLambda(args, body, location)
}

export class ExprDo {
  exprs: Expr[]

  constructor(exprs: Expr[]) {
    this.exprs = exprs
  }
}

function parseDo(lexer: Lexer): ExprDo {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let exprs: Expr[] = []
  let token = lexer.lookNext().check()
  while (!(token.type === TokenType.symbol && token.literal === ')')) {
    let expr = parseExpr(lexer)
    exprs.push(expr)

    token = lexer.lookNext().check()
  }

  // cast off ')' symbol
  lexer.next()

  return new ExprDo(exprs)
}

class Macro {
  name: string
  pattern: MacroPattern
  body: MacroExpr

  constructor(name: string, args: MacroArg[], body: MacroExpr) {
    this.name = name
    this.pattern = new MacroPattern(args)
    this.body = body
  }

  /**
   * @returns `false` if a macro of the same named had been registered.
   */
  register(): boolean {
    if (macroReg.has(this.name)) {
      return false
    }
    macroReg.set(this.name, this)
    return true
  }
}

function parseMacro(lexer: Lexer): Macro {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }
  let location = ` at line ${lexer.line}, column ${lexer.column}`

  let token = lexer.next().check()
  if (!(token.type === TokenType.symbol && token.literal === '(')) {
    throw new SyntaxError(`expected '('${token.locate()}`)
  }

  token = lexer.next().check()
  if (!(token.type === TokenType.identifier)) {
    throw new SyntaxError(`syntax error: expected IDENTIFIER${token.locate()}`)
  }
  let name = token.literal

  let args: MacroArg[] = []
  token = lexer.lookNext().check()
  if (token.type === TokenType.symbol && token.literal === ')') {
    throw new SyntaxError(`expected macro argument list`)
  }

  while (!(token.type === TokenType.symbol && token.literal === ')')) {
    let arg = parseMacroArg(lexer)
    args.push(arg)
    token = lexer.lookNext().check()
  }

  // skip ')'
  lexer.next()

  let expr = parseMacroExpr(lexer)

  let macro = new Macro(name, args, expr)
  if (!macro.register()) {
    throw new SyntaxError(`redefined macro '${name}'${location}`)
  }

  return macro
}

type MacroArg = number | string | Var | MacroArgStruct | MacroArgSection | MacroArgSelector | MacroArgParen |  MacroArgRepeat

type MacroStruct = 'expr' | 'token' | 'number' | 'string' | 'ident'

class MacroArgStruct {
  name: string | undefined
  struct: MacroStruct

  constructor(name: string | undefined, struct: MacroStruct) {
    this.name = name
    this.struct = struct
  }
}

class MacroArgSection {
  name: string | undefined
  subs: MacroArg[] // >= 1

  constructor(name: string | undefined, subs: MacroArg[]) {
    this.name = name
    this.subs = subs
  }
}

class MacroArgSelector {
  name: string | undefined
  subs: MacroArg[] // >= 2

  constructor(name: string | undefined, subs: MacroArg[]) {
    this.name = name
    this.subs = subs
  }
}

class MacroArgParen {
  type: '(' | '[' | '{'
  subs: MacroArg[]

  constructor(type: '(' | '[' | '{', subs: MacroArg[]) {
    this.type = type
    this.subs = subs
  }
}

class MacroArgRepeat {
  selector: '?' | '*' | '+'
  arg: MacroArg

  constructor(selector: '?' | '*' | '+', arg: MacroArg) {
    this.selector = selector
    this.arg = arg
  }
}

function parseMacroArg(lexer: Lexer): MacroArg {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let token = lexer.next().check()
  if (token.type === TokenType.number) {
    let n = parseFloat(token.literal)
    // if (isNaN(n)) {
    //   throw new Error('number NaN')
    // }
    return n
  } else if (token.type === TokenType.string) {
    return token.literal.slice(1, -1)
  } else if (token.type === TokenType.identifier) {
    return new Var(token.literal, token.locate())
  } else if (token.type === TokenType.symbol) {
    if (token.literal === '%') {
      let name = ''

      token = lexer.next().check()
      if (token.type === TokenType.identifier) {
        // %name...
        //  ^
        name = token.literal
        token = lexer.next().check()
      }

      // %name...
      //      ^
      // %...
      //  ^
      if (token.type === TokenType.symbol) {
        // %name...
        //      ^
        if (token.literal === '(') {
          // %name(...)
          //      ^
          let args: MacroArg[] = []

          token = lexer.lookNext().check()
          while (!(token.type === TokenType.symbol && token.literal === ')')) {
            let arg = parseMacroArg(lexer)
            args.push(arg)

            token = lexer.lookNext().check()
          }

          lexer.next() // skip ')'

          return new MacroArgSection(name, args)
        } else if (token.literal === '[') {
          // %name[...]
          //      ^
          let choices: MacroArg[] = []

          token = lexer.lookNext().check()
          while (!(token.type === TokenType.symbol && token.literal === ']')) {
            let arg = parseMacroArg(lexer)
            choices.push(arg)

            token = lexer.lookNext().check()
          }

          lexer.next() // skip ']'

          return new MacroArgSelector(name, choices)
        } else if (token.literal === '{') {
          // %name{...}
          //      ^
          token = lexer.next().check()
          if (token.type === TokenType.identifier) {
            // %name{...}
            //       ^^^
            if (token.literal === 'expr'
             || token.literal === 'token'
             || token.literal === 'number'
             || token.literal === 'string'
             || token.literal === 'ident') {
              const struct = token.literal

              token = lexer.next().check()
              if (!(token.type === TokenType.symbol && token.literal === '}')) {
                throw new SyntaxError(`expected '}'${token.locate()}`)
              }

              return new MacroArgStruct(name, struct)
            } else {
              throw new SyntaxError(`expected "expr" "token" "number" "string" or "ident"${token.locate()}`)
            }
          } else {
            throw new SyntaxError(`expected "expr" "token" "number" "string" or "ident"${token.locate()}`)
          }
        } else {
          throw new SyntaxError(`expected '(' '[' or '{'${token.locate()}`)
        }
      } else {
        throw new SyntaxError(`expected '(' '[' or '{'${token.locate()}`)
      }
    } else if (token.literal === '(' || token.literal === '[' || token.literal === '{') {
      const parenType = token.literal
      const endpr = closedParen(parenType)

      let args: MacroArg[] = []
      token = lexer.lookNext().check()
      while (!(token.type === TokenType.symbol && token.literal === endpr)) {
        let arg = parseMacroArg(lexer)
        args.push(arg)

        token = lexer.lookNext().check()
      }

      lexer.next() // skip endpr

      return new MacroArgParen(parenType, args)
    } else {
      throw new SyntaxError(`unexpected '${token.literal}'${token.locate()}`)
    }
  } else {
    throw new Error('not possible')
  }
}

function closedParen(opPr: '(' | '[' | '{'): ')' | ']' | '}' {
  return opPr === '(' ? ')' : opPr === '[' ? ']' : '}'
}

type MacroExpr = number | string | Var | MacroVar | MacroParenExpr

class MacroVar {
  name: string
  intoList: boolean

  constructor(name: string, intoList: boolean = false) {
    this.name = name
    this.intoList = intoList
  }
}

class MacroParenExpr {
  type: '(' | '[' | '{'
  exprs: MacroExpr[]

  constructor(type: '(' | '[' | '{', exprs: MacroExpr[]) {
    this.type = type
    this.exprs = exprs
  }
}

function parseMacroExpr(lexer: Lexer): MacroExpr {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let token = lexer.next().check()
  if (token.type === TokenType.number) {
    return parseFloat(token.literal)
  } else if (token.type === TokenType.string) {
    return token.literal.slice(1, -1)
  } else if (token.type === TokenType.identifier) {
    return new Var(token.literal, token.locate())
  } else if (token.type === TokenType.symbol) {
    if (token.literal === '%') {
      token = lexer.next().check()
      if (token.type === TokenType.identifier) {
        // %name
        return new MacroVar(token.literal)
      } else if (token.type === TokenType.symbol && token.literal === '%') {
        // %%...
        //  ^
        token = lexer.next().check()
        if (token.type !== TokenType.identifier) {
          throw new SyntaxError(`syntax error: expected IDENTIFIER${token.locate()}`)
        }

        // %%name
        return new MacroVar(token.literal)
      } else {
        throw new SyntaxError(`expected '%' or IDENTIFIER${token.locate()}`)
      }
    } else if (token.literal === '(' || token.literal === '[' || token.literal === '{') {
      const parenType = token.literal
      const endpr = closedParen(parenType)

      let exprs: MacroExpr[] = []
      token = lexer.lookNext().check()
      while (!(token.type === TokenType.symbol && token.literal === endpr)) {
        let expr = parseMacroExpr(lexer)
        exprs.push(expr)

        token = lexer.lookNext().check()
      }

      lexer.next() // skip endpr

      return new MacroParenExpr(parenType, exprs)
    } else {
      throw new SyntaxError(`unexpected '${token.literal}'${token.locate()}`)
    }
  } else {
    throw new Error('not possible')
  }
}

class StateTransition {
  nextState: string
  operation: 'shift' | 'reduce'
}

// Macro expansion automata
class MacroPattern {
  /** a state is a unique string */
  state: string
  /** a state and a tokentype forms the key; value is a function manipulating the stack and returns the next state */
  stateMap: Map<string, (stack: Expr[]) => string>

  constructor(args: MacroArg[]) {
    //
  }

  match(stack: Expr[]): { name: string, val: Expr } {
  }
}

/**
 * Expands the macro call to generate an equivalent do expression at the same position.
 * This is actually an LR parser of macro call argument list. The syntax of the parser is defined by the macro definition.
 * See ./syntax_bnf for an example parsing.
 */
function expandMacro(macro: Macro, items: Expr[], location: string): ExprDo {
  // This will become a map of macro parameters to the actual arguments (macro bound), to be used to replace macro contents in the macro definition body.
  let structMap: Map<string, Expr> = new Map()
  function regArg(name: string, val: Expr): void {
    if (structMap.has(name)) {
      throw new SyntaxError(`in macro ${macro.name}: duplicated macro argument bound name '${name}'${location}`)
    }
    structMap.set(name, val)
  }

  let stack: Expr[] = []

  for (let expr = items.shift(); expr != undefined; ) {
    stack.push(expr)
    let reg = macro.pattern.match(stack)
    regArg(reg.name, reg.val)
    expr = items.shift()
  }

  // TODO: replace macro expr

  return new ExprDo([/* TODO: resultant expression */])
}

// TODO: Test parseMacro
// TODO: Implement expand of macros
