import { Lexer, TokenType } from './lexer'
import { Either, Right, Left } from './utils'

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

type SyntaxHandler = (lexer: Lexer) => Either<ExprLetVar | ExprLetFunc | ExprLambda | ExprDo, string>

// reserved identifiers
export const KEYWORD: {[keys: string]: SyntaxHandler | undefined} = {
  'let': parseLet,
  'macro': (_) => { throw new Error('not implemented') },
  '\\': parseLambda,
  'do': parseDo,
}

export type Expr = number | string | Var | SExpr | ListExpr | DictExpr | ExprLetVar | ExprLetFunc | ExprLambda | ExprDo

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
        return new Right(`not implemented: '${token.literal}'${token.locate()}`)
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

function parseSExpr(lexer: Lexer): Either<SExpr | ExprLetVar | ExprLetFunc | ExprLambda | ExprDo, string> {
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
    if (lexer.eof) {
      return new Right(UNEXP_EOF)
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
    if (lexer.eof) {
      return new Right(UNEXP_EOF)
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
    if (lexer.eof) {
      return new Right(UNEXP_EOF)
    }

    let token = lexer.next()
    if (token.type === TokenType.symbol && token.literal === '(') {
      let entry = parseDictEntry(lexer)
      if (!entry.isLeft()) {
        return new Right(entry.unwrapRight())
      }

      result.entries.push(entry.unwrapLeft())
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
  if (!(token.type === TokenType.symbol && token.literal === ')')) {
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
      if (!(token.type === TokenType.symbol && token.literal === ')')) {
        return new Right(`syntax error: expected ')'${token.locate()}`)
      }

      return new Left(new ExprLetFunc(id, params, body.unwrapLeft(), location))
    }
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
  if (!(token.type === TokenType.symbol && token.literal === '(')) {
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
  if (!(token.type === TokenType.symbol && token.literal === ')')) {
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
    if (lexer.eof) {
      return new Right(UNEXP_EOF)
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
