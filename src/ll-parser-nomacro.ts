import { Lexer, TokenType, EOF, SyntaxError } from './lexer-except'
import { Either, Right, Left } from './utils'

export class Parser {
  lexer: Lexer

  constructor(filepath: string, source: string) {
    this.lexer = new Lexer(filepath, source)
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

type SyntaxHandler = (lexer: Lexer) => ExprLetVar | ExprLetFunc | ExprLambda | ExprDo | ExprExec

// reserved identifiers
export const KEYWORD: {[keys: string]: SyntaxHandler | undefined} = {
  'let': parseLet,
  '\\': parseLambda,
  'do': parseDo,
  '@': parseExprExec,
}

export type Expr = number | string | Var | SExpr | ListExpr | DictExpr | ExprLetVar | ExprLetFunc | ExprLambda | ExprDo | ExprExec

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

function parseSExpr(lexer: Lexer): SExpr | ExprLetVar | ExprLetFunc | ExprLambda | ExprDo {
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

  while (!(token.type === TokenType.symbol && token.literal === ')')) {
    let expr = parseExpr(lexer)

    items.push(expr)

    token = lexer.lookNext().check()
  }

  // cast off ')' symbol
  lexer.next()

  return new SExpr(items, location)
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

export class ExprExec {
  exprs: Expr[]
  location: string

  constructor(exprs: Expr[], location: string) {
    this.exprs = exprs
    this.location = location
  }
}

function parseExprExec(lexer: Lexer): ExprExec {
  if (lexer.eof) {
    throw new SyntaxError(UNEXP_EOF)
  }

  let location = ` at line ${lexer.line}, column ${lexer.column}`

  let exprs: Expr[] = []
  let token = lexer.lookNext().check()
  while (!(token.type === TokenType.symbol && token.literal === ')')) {
    let expr = parseExpr(lexer)
    exprs.push(expr)

    token = lexer.lookNext().check()
  }

  // skip ')'
  lexer.next()

  return new ExprExec(exprs, location)
}
