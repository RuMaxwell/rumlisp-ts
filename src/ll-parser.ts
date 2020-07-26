import { Lexer, TokenType, Token } from './lexer'
import { Either, Right, Left } from './utils'
import { symlink } from 'fs'
import { ERANGE } from 'constants'

export class Parser {
  lexer: Lexer

  constructor(source: string) {
    this.lexer = new Lexer(source)
  }

  parse(): Either<Expr[], string> {
    if (this.lexer.eof) {
      return new Right('eof')
    }

    let result: Either<Expr[], string> = new Left([])

    while (true) {
      let res = parseExpr(this.lexer)

      if (res.isLeft()) {
        result.unwrapLeft().push(res.unwrapLeft())
      } else {
        let r = res.unwrapRight()
        if (r !== 'eof') {
          result = new Right(res.unwrapRight())
        }
        break
      }
    }

    return result
  }
}

const UNEXP_EOF = 'syntax error: unexpected EOF'
// const UNEXP = function (literal: string, locate: string) { return `syntax error: unexpected ${literal}${locate}` }
// const EXPCT = function (literal: string, locate: string) { return `syntax error: unexpected ${literal}${locate}` }

type SyntaxHandler = (lexer: Lexer) => Either<ExprLetVar | ExprLetFunc | ExprLambda | ExprDo | Macro, string>

const macroReg: Map<string, Macro> = new Map()

// reserved identifiers
export const KEYWORD: {[keys: string]: SyntaxHandler | undefined} = {
  'let': parseLet,
  '\\': parseLambda,
  'do': parseDo,
  'macro': parseMacro,
}

export type Expr = number | string | Var | SExpr | ListExpr | DictExpr | ExprLetVar | ExprLetFunc | ExprLambda | ExprDo | Macro

function parseExpr(lexer: Lexer): Either<Expr, string> {
  if (lexer.eof) {
    return new Right('eof')
  }

  let token = lexer.next()
  if (token.type === TokenType.number) {
    return new Left(parseFloat(token.literal))
  } else if (token.type === TokenType.string) {
    return new Left(token.literal.slice(1, token.literal.length - 1))
  } else if (token.type === TokenType.symbol) {
    switch (token.literal) {
      case '(':
        return parseSExpr(lexer)
      case '[':
        return parseListExpr(lexer)
      case '{':
        return parseDictExpr(lexer)
      default:
        return new Right(`syntax error: unexpected '${token.literal}'${token.locate()}`)
        // return new Right(`not implemented: '${token.literal}'${token.locate()}`)
    }
  } else if (token.type === TokenType.identifier) {
    if (KEYWORD[token.literal] !== undefined) {
      return new Right(`syntax error: unexpected keyword ${token.literal}${token.locate()}`)
    } else {
      return new Left(new Var(token.literal, token.locate()))
    }
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else if (token.type === TokenType.eof) {
    return new Right('eof')
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

function parseSExpr(lexer: Lexer): Either<SExpr | ExprLetVar | ExprLetFunc | ExprLambda | ExprDo | Macro, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let location = ` at line ${lexer.line}, column ${lexer.column}`

  let items: Expr[] = []

  let token = lexer.lookNext()
  let handler = KEYWORD[token.literal]
  if (handler !== undefined) {
    lexer.next()
    return handler(lexer)
  }

  while (!(token.type === TokenType.symbol && token.literal === ')')) {
    if (token.type === TokenType.eof) {
      return new Right(UNEXP_EOF)
    } else if (token.type === TokenType.err) {
      return new Right(token.toString())
    }

    let expr = parseExpr(lexer)
    if (!expr.isLeft()) {
      return new Right(expr.unwrapRight())
    }

    items.push(expr.unwrapLeft())

    token = lexer.lookNext()
  }
  
  // cast off ')' symbol
  lexer.next()

  return new Left(new SExpr(items, location))
}

export class ListExpr {
  items: Expr[]

  constructor(items: Expr[]) {
    this.items = items
  }
}

function parseListExpr(lexer: Lexer): Either<ListExpr, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let result = new ListExpr([])
  let token = lexer.lookNext()
  while (!(token.type === TokenType.symbol && token.literal === ']')) {
    if (token.type === TokenType.eof) {
      return new Right(UNEXP_EOF)
    } else if (token.type === TokenType.err) {
      return new Right(token.toString())
    }

    let expr = parseExpr(lexer)
    if (!expr.isLeft()) {
      return new Right(expr.unwrapRight())
    }

    result.items.push(expr.unwrapLeft())

    token = lexer.lookNext()
  }

  // cast off ']' symbol
  lexer.next()

  return new Left(result)
}

export class DictEntry {
  key: Expr
  value: Expr

  constructor(key: Expr, value: Expr) {
    this.key = key
    this.value = value
  }
}

function parseDictEntry(lexer: Lexer): Either<DictEntry, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let key = parseExpr(lexer)
  if (!key.isLeft()) {
    return new Right(key.unwrapRight())
  }
  let key_ = key.unwrapLeft()

  let value = parseExpr(lexer)
  if (!value.isLeft()) {
    return new Right(value.unwrapRight())
  }
  let value_ = value.unwrapLeft()

  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }
  let token = lexer.next()
  if (token.type === TokenType.symbol && token.literal === ')') {
    return new Left(new DictEntry(key_, value_))
  } else if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else {
    return new Right(`syntax error: expected ')'${token.locate()}`)
  }
}

export class DictExpr {
  entries: DictEntry[]

  constructor(entries: DictEntry[]) {
    this.entries = entries
  }
}

function parseDictExpr(lexer: Lexer): Either<DictExpr, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let result = new DictExpr([])
  let token_ = lexer.lookNext()
  while (!(token_.type === TokenType.symbol && token_.literal === '}')) {
    if (token_.type === TokenType.eof) {
      return new Right(UNEXP_EOF)
    } else if (token_.type === TokenType.err) {
      return new Right(token_.toString())
    }

    let token = lexer.next()
    if (token.type === TokenType.symbol && token.literal === '(') {
      let entry = parseDictEntry(lexer)
      if (!entry.isLeft()) {
        return new Right(entry.unwrapRight())
      }

      result.entries.push(entry.unwrapLeft())
    } else if (token.type === TokenType.eof) {
      return new Right(UNEXP_EOF)
    } else if (token.type === TokenType.err) {
      return new Right(token.toString())
    } else {
      return new Right(`syntax error: expected '('${token.locate()}`)
    }

    token_ = lexer.lookNext()
  }

  // cast off '}' symbol
  lexer.next()

  return new Left(result)
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

function parseLet(lexer: Lexer): Either<ExprLetVar | ExprLetFunc, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let token = lexer.next()

  if (token.type === TokenType.identifier) {
    if (KEYWORD[token.literal] !== undefined) {
      return new Right(`syntax error: unexpected keyword ${token.literal}${token.locate()}`)
    }
    return parseLetVar(lexer, token.literal)
  } else if (token.type === TokenType.symbol && token.literal === '(') {
    return parseLetFunc(lexer)
  } else if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else {
    return new Right(`syntax error: expected IDENTIFIER or '('${token.locate()}`)
  }
}

function parseLetVar(lexer: Lexer, id: string): Either<ExprLetVar, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let expr = parseExpr(lexer)
  if (!expr.isLeft()) {
    return new Right(expr.unwrapRight())
  }

  let elv = new ExprLetVar(id, expr.unwrapLeft())

  let token = lexer.next()
  if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else if (!(token.type === TokenType.symbol && token.literal === ')')) {
    return new Right(`syntax error: expected ')'${token.locate()}`)
  }

  return new Left(elv)
}

function parseLetFunc(lexer: Lexer): Either<ExprLetFunc, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let token = lexer.next()
  if (token.type === TokenType.identifier) {
    if (KEYWORD[token.literal] !== undefined) {
      return new Right(`syntax error: unexpected keyword ${token.literal}${token.locate()}`)
    } else {
      let id = token.literal
      let location = token.locate()
      let params: string[] = []

      let paren = lexer.saveParenCounter()
      paren.decParen()

      while (!paren.eq(lexer.parenCounter)) {
        if (lexer.eof) {
          return new Right(UNEXP_EOF)
        }

        token = lexer.next()
        if (token.type === TokenType.symbol && token.literal === ')') {
          break
        } else if (token.type === TokenType.identifier) {
          if (KEYWORD[token.literal] !== undefined) {
            return new Right(`syntax error: unexpected keyword ${token.literal}${token.locate()}`)
          } else {
            params.push(token.literal)
          }
        } else if (token.type === TokenType.eof) {
          return new Right(UNEXP_EOF)
        } else if (token.type === TokenType.err) {
          return new Right(token.toString())
        } else {
          return new Right(`syntax error: expected IDENTIFIER${token.locate()}`)
        }
      }

      let body = parseExpr(lexer)
      if (!body.isLeft()) {
        return new Right(body.unwrapRight())
      }

      token = lexer.next()
      if (token.type === TokenType.eof) {
        return new Right(UNEXP_EOF)
      } else if (token.type === TokenType.err) {
        return new Right(token.toString())
      } else if (!(token.type === TokenType.symbol && token.literal === ')')) {
        return new Right(`syntax error: expected ')'${token.locate()}`)
      }

      return new Left(new ExprLetFunc(id, params, body.unwrapLeft(), location))
    }
  } else if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else {
    return new Right(`syntax error: expected IDENTIFIER${token.locate()}`)
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

function parseLambda(lexer: Lexer): Either<ExprLambda, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }
  let location = ` at line ${lexer.line}, column ${lexer.column}`

  let token = lexer.next()
  if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else if (!(token.type === TokenType.symbol && token.literal === '(')) {
    return new Right(`syntax error: expected '('${token.locate()}`)
  }

  let paren = lexer.saveParenCounter()
  paren.decParen()
  let args: string[] = []
  while (!paren.eq(lexer.parenCounter)) {
    if (lexer.eof) {
      return new Right(UNEXP_EOF)
    }

    token = lexer.next()
    if (token.type === TokenType.symbol && token.literal === ')') {
      break
    } else if (token.type === TokenType.identifier) {
      args.push(token.literal)
    } else if (token.type === TokenType.eof) {
      return new Right(UNEXP_EOF)
    } else if (token.type === TokenType.err) {
      return new Right(token.toString())
    } else {
      return new Right(`syntax error: expected IDENTIFIER${token.locate()}`)
    }
  }

  let body = parseExpr(lexer)
  if (!body.isLeft()) {
    return new Right(body.unwrapRight())
  }

  token = lexer.next()
  if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else if (!(token.type === TokenType.symbol && token.literal === ')')) {
    return new Right(`syntax error: expected ')'${token.locate()}`)
  }

  return new Left(new ExprLambda(args, body.unwrapLeft(), location))
}

export class ExprDo {
  exprs: Expr[]

  constructor(exprs: Expr[]) {
    this.exprs = exprs
  }
}

function parseDo(lexer: Lexer): Either<ExprDo, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let exprs: Expr[] = []
  let token = lexer.lookNext()
  while (!(token.type === TokenType.symbol && token.literal === ')')) {
    if (token.type === TokenType.eof) {
      return new Right(UNEXP_EOF)
    } else if (token.type === TokenType.err) {
      return new Right(token.toString())
    }

    let expr = parseExpr(lexer)
    if (expr.isLeft()) {
      exprs.push(expr.unwrapLeft())
    } else {
      return new Right(expr.unwrapRight())
    }

    token = lexer.lookNext()
  }

  // cast off ')' symbol
  lexer.next()

  return new Left(new ExprDo(exprs))
}

class Macro {
  name: string
  pattern: MacroArg[]
  body: MacroExpr

  structMap: Map<string, Expr | Token> = new Map()

  constructor(name: string, pattern: MacroArg[], body: MacroExpr) {
    this.name = name
    this.pattern = pattern
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

function parseMacro(lexer: Lexer): Either<Macro, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let token = lexer.next()
  if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else if (!(token.type === TokenType.symbol && token.literal === '(')) {
    return new Right(`syntax error: expected '('${token.locate()}`)
  }

  token = lexer.next()
  if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.literal)
  } else if (!(token.type === TokenType.identifier)) {
    return new Right(`syntax error: expected IDENTIFIER${token.locate()}`)
  }
  let name = token.literal

  let args: MacroArg[] = []
  token = lexer.lookNext()
  if (token.type === TokenType.symbol && token.literal === ')') {
    return new Right(`syntax error: expected macro argument list`)
  }

  while (!(token.type === TokenType.symbol && token.literal === ')')) {
    if (token.type === TokenType.eof) {
      return new Right(UNEXP_EOF)
    } else if (token.type === TokenType.err) {
      return new Right(token.literal)
    }

    let arg = parseMacroArg(lexer)
    if (arg.isLeft()) {
      args.push(arg.unwrapLeft())
      token = lexer.next()
    } else {
      return new Right(arg.unwrapRight())
    }

    token = lexer.lookNext()
  }

  // skip ')'
  lexer.next()

  let expr = parseMacroExpr(lexer)
  if (!expr.isLeft()) {
    return new Right(expr.unwrapRight())
  }

  return new Left(new Macro(name, args, expr.unwrapLeft()))
}

type MacroArg = number | string | Var | MacroArgAtom | MacroArgSection | MacroArgSelector | MacroArgParen |  MacroArgRepeat

type MacroStruct = 'expr' | 'token' | 'number' | 'string' | 'ident'

class MacroArgAtom {
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

function parseMacroArg(lexer: Lexer): Either<MacroArg, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let token = lexer.next()
  if (token.type === TokenType.number) {
    let n = parseFloat(token.literal)
    if (isNaN(n)) {
      throw new Error('number NaN')
    }
    return new Left(n)
  } else if (token.type === TokenType.string) {
    return new Left(token.literal.slice(1, -1))
  } else if (token.type === TokenType.identifier) {
    return new Left(new Var(token.literal, token.locate()))
  } else if (token.type === TokenType.symbol) {
    if (token.literal === '%') {
      let name = ''

      token = lexer.next()
      if (token.type === TokenType.eof) {
        return new Right(UNEXP_EOF)
      } else if (token.type === TokenType.err) {
        return new Right(token.toString())
      } else if (token.type === TokenType.identifier) {
        // %name...
        //  ^
        name = token.literal
        token = lexer.next()
      }

      // %name...
      //      ^
      // %...
      //  ^
      if (token.type === TokenType.eof) {
        return new Right(UNEXP_EOF)
      } else if (token.type === TokenType.err) {
        return new Right(token.toString())
      } else if (token.type === TokenType.symbol) {
        // %name...
        //      ^
        if (token.literal === '(') {
          // %name(...)
          //      ^
          let args: MacroArg[] = []

          token = lexer.lookNext()
          while (!(token.type === TokenType.symbol && token.literal === ')')) {
            if (token.type === TokenType.eof) {
              return new Right(UNEXP_EOF)
            } else if (token.type === TokenType.err) {
              return new Right(token.toString())
            }

            let arg = parseMacroArg(lexer)
            if (arg.isLeft()) {
              args.push(arg.unwrapLeft())
            } else {
              return new Right(arg.unwrapRight())
            }

            token = lexer.lookNext()
          }

          lexer.next() // skip ')'

          return new Left(new MacroArgSection(name, args))
        } else if (token.literal === '[') {
          // %name[...]
          //      ^
          let choices: MacroArg[] = []

          token = lexer.lookNext()
          while (!(token.type === TokenType.symbol && token.literal === ']')) {
            if (token.type === TokenType.eof) {
              return new Right(UNEXP_EOF)
            } else if (token.type === TokenType.err) {
              return new Right(token.toString())
            }

            let arg = parseMacroArg(lexer)
            if (arg.isLeft()) {
              choices.push(arg.unwrapLeft())
            } else {
              return new Right(arg.unwrapRight())
            }

            token = lexer.lookNext()
          }

          lexer.next() // skip ']'

          return new Left(new MacroArgSelector(name, choices))
        } else if (token.literal === '{') {
          // %name{...}
          //      ^
          token = lexer.next()
          if (token.type === TokenType.eof) {
            return new Right(UNEXP_EOF)
          } else if (token.type === TokenType.err) {
            return new Right(token.toString())
          } else if (token.type === TokenType.identifier) {
            // %name{...}
            //       ^^^
            if (token.literal === 'expr'
             || token.literal === 'token'
             || token.literal === 'number'
             || token.literal === 'string'
             || token.literal === 'ident') {
              const struct = token.literal

              token = lexer.next()
              if (token.type === TokenType.eof) {
                return new Right(UNEXP_EOF)
              } else if (token.type === TokenType.err) {
                return new Right(token.toString())
              } else if (!(token.type === TokenType.symbol && token.literal === '}')) {
                return new Right(`syntax error: expected '}'${token.locate()}`)
              }

              return new Left(new MacroArgAtom(name, struct))
            } else {
              return new Right(`syntax error: expected "expr" "token" "number" "string" or "ident"${token.locate()}`)
            }
          } else {
            return new Right(`syntax error: expected "expr" "token" "number" "string" or "ident"${token.locate()}`)
          }
        } else {
          return new Right(`syntax error: expected '(' '[' or '{'${token.locate()}`)
        }
      } else {
        return new Right(`syntax error: expected '(' '[' or '{'${token.locate()}`)
      }
    } else if (token.literal === '(' || token.literal === '[' || token.literal === '{') {
      const parenType = token.literal
      const endpr = closedParen(parenType)

      let args: MacroArg[] = []
      token = lexer.lookNext()
      while (!(token.type === TokenType.symbol && token.literal === endpr)) {
        if (token.type === TokenType.eof) {
          return new Right(UNEXP_EOF)
        } else if (token.type === TokenType.err) {
          return new Right(token.toString())
        }

        let arg = parseMacroArg(lexer)
        if (arg.isLeft()) {
          args.push(arg.unwrapLeft())
        } else {
          return new Right(arg.unwrapRight())
        }

        token = lexer.lookNext()
      }

      lexer.next() // skip endpr

      return new Left(new MacroArgParen(parenType, args))
    } else {
      return new Right(`syntax error: unexpected '${token.literal}'${token.locate()}`)
    }
  } else if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
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

function parseMacroExpr(lexer: Lexer): Either<MacroExpr, string> {
  if (lexer.eof) {
    return new Right(UNEXP_EOF)
  }

  let token = lexer.next()
  if (token.type === TokenType.eof) {
    return new Right(UNEXP_EOF)
  } else if (token.type === TokenType.err) {
    return new Right(token.toString())
  } else if (token.type === TokenType.number) {
    return new Left(parseFloat(token.literal))
  } else if (token.type === TokenType.string) {
    return new Left(token.literal.slice(1, -1))
  } else if (token.type === TokenType.identifier) {
    return new Left(new Var(token.literal, token.locate()))
  } else if (token.type === TokenType.symbol) {
    if (token.literal === '%') {
      token = lexer.next()
      if (token.type === TokenType.eof) {
        return new Right(UNEXP_EOF)
      } else if (token.type === TokenType.err) {
        return new Right(token.toString())
      } else if (token.type === TokenType.identifier) {
        // %name
        return new Left(new MacroVar(token.literal))
      } else if (token.type === TokenType.symbol && token.literal === '%') {
        // %%...
        //  ^
        token = lexer.next()
        if (token.type === TokenType.eof) {
          return new Right(UNEXP_EOF)
        } else if (token.type === TokenType.err) {
          return new Right(token.toString())
        } else if (token.type !== TokenType.identifier) {
          return new Right(`syntax error: expected IDENTIFIER${token.locate()}`)
        }

        // %%name
        return new Left(new MacroVar(token.literal))
      } else {
        return new Right(`syntax error: expected '%' or IDENTIFIER${token.locate()}`)
      }
    } else if (token.literal === '(' || token.literal === '[' || token.literal === '{') {
      const parenType = token.literal
      const endpr = closedParen(parenType)

      let exprs: MacroExpr[] = []
      token = lexer.lookNext()
      while (!(token.type === TokenType.symbol && token.literal === endpr)) {
        if (token.type === TokenType.eof) {
          return new Right(UNEXP_EOF)
        } else if (token.type === TokenType.err) {
          return new Right(token.toString())
        }

        let expr = parseMacroExpr(lexer)
        if (expr.isLeft()) {
          exprs.push(expr.unwrapLeft())
        } else {
          return new Right(expr.unwrapRight())
        }

        token = lexer.lookNext()
      }

      lexer.next() // skip endpr

      return new Left(new MacroParenExpr(parenType, exprs))
    } else {
      return new Right(`syntax error: unexpected '${token.literal}'${token.locate()}`)
    }
  } else {
    throw new Error('not possible')
  }
}

// TODO: Test parseMacro
// TODO: Implement expand of macros

// -TODO-: 改写 lexer.next() 和 lexer.lookNext() 返回 TokenUnchecked
// token = lexer.next() 后，必须调用 token.check(:TokenType, callback: (:Token) => Either<L, string>) 返回 Either<L, string>
// check 内部自动检查 eof, err，并保证在实际 TokenType 不等于 expected 的 TokenType 时返回 Right(EXPECTED...) 错误
// 如果 check 调用没有给 callback，直接返回 Either<L, string> 以供后续检查
// 即要么使用回调式：
// return lexer.next().check(TokenType.symbol, function(token) { ... })
// 要么使用分步逻辑式：
// let token_ = lexer.next()
// let check = token_.check(TokenType.symbol)
// if (!check.isLeft()) { return check }
// let token = check.unwrapLeft()
// ...
// 第一次重构发现并未有效缩减代码量，虽然能够利用编译器提示这里需要 check，但还不如直接 wrap 一个含有 token 的 trivial 类型来做这个。
