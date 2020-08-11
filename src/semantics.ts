import * as Parser from './ll-parser-except'
import { Either, Right, Left } from './utils'
import * as path from 'path'
import * as fs from 'fs'
import * as proc from 'child_process'

export type Value = Unit | number | string | List | Dict | FileHandler | Closure | BuiltinClosure

class Unit {
  toString(): string {
    return '()'
  }
}
const unit = new Unit()

export class List {
  values: Value[]

  constructor(values: Value[]) {
    this.values = values
  }

  toString(): string {
    let s = `[`
    for (let i in this.values) {
      s += `${this.values[i]} `
    }
    s = s.trim()
    s += ']'
    return s
  }
}

export class Dict {
  data: Map<Value, Value>

  constructor(data: Map<Value, Value>) {
    this.data = data
  }

  toString(): string {
    let s = 'Dict { '
    let keyIter = this.data.keys()
    for (let key = keyIter.next(); !key.done; key = keyIter.next()) {
      if (typeof key.value === 'string') {
        if (key.value.startsWith('__')) {
          continue
        }
      }
      let v = this.data.get(key.value)
      let vs = `${v}`
      if (typeof v === 'string') {
        vs = `"${vs}"`
      }
      s += `${key.value}: ${vs}, `
    }
    return s += '}'
  }

  repr(): string {
    let s = 'Dict { '
    let keyIter = this.data.keys()
    for (let key = keyIter.next(); !key.done; key = keyIter.next()) {
      let v = this.data.get(key.value)
      let vs = `${v}`
      if (typeof v === 'string') {
        vs = `"${vs}"`
      }
      s += `${key.value}: ${vs}, `
    }
    return s += '}'
  }
}

class FileHandler {
  relpath: string
  abspath: string
  stats?: fs.Stats
  content?: string
  /** if this is a valid RumLisp source file, its content will be loaded into this Dict */
  mod?: Dict

  constructor(relpath: string) {
    this.relpath = relpath
    this.abspath = path.resolve(relpath)
  }

  read(): string | undefined {
    if (this.content === undefined) {
      try {
        this.stats = fs.statSync(this.abspath)
        this.content = fs.readFileSync(this.abspath).toString()
      } catch (e) {
        console.log(e)
        return undefined
      }
    }
    return this.content
  }

  exec(args: string): string | undefined {
    try {
      return proc.execSync(`${this.relpath} ${args}`).toString()
    } catch (e) {
      let err = e as Error
      if (err.message.match(/Command failed/) !== null) {
        try {
          return proc.execSync(`${this.abspath} ${args}`).toString()
        } catch (e) {
          console.log(e)
        }
      } else {
        console.log(e)
      }
    }
  }

  import(): Dict | undefined {
    this.read()
    if (this.content === undefined) {
      console.error(`import failed from ${this.abspath}: could not read`)
      return
    }

    const parser = new Parser.Parser(this.abspath, this.content)
    let ast = parser.parse()
    if (ast.isLeft()) {
      let env = makeInitialEnv()
      let modMap = new Map<Value, Value>([['__path__', this.abspath], ['__content__', this.content]])

      let exprs = ast.unwrapLeft()
      let vals: Value[] = []
      for (let i = 0; i < exprs.length; i++) {
        let val = evaluate(env, exprs[i])
        if (val.isLeft()) {
          vals.push(val.unwrapLeft())
        } else {
          console.error(`import failed from ${this.abspath}: ${val.unwrapRight()}`)
        }
      }

      let iter = env.context.keys()
      for (let key = iter.next(); !key.done; key = iter.next()) {
        if (!INITIAL_ENV.context.has(key.value)) {
          let v = env.context.get(key.value)
          if (v === undefined) throw 'not possible'
          modMap.set(key.value, v)
        }
      }

      this.mod = new Dict(modMap)
      return this.mod
    } else {
      console.error(`import failed from ${this.abspath}: ${ast.unwrapRight()}`)
    }
  }
}

class ClosureMeta {
  id: string
  location: string

  constructor(id: string, location: string) {
    this.id = id
    this.location = location
  }
}

export class Closure {
  meta: ClosureMeta
  env: Env
  params: string[]
  body: Parser.Expr

  constructor(meta: ClosureMeta, env: Env, params: string[], body: Parser.Expr) {
    this.meta = meta
    this.env = env
    this.params = params
    this.body = body
  }

  toString(): string {
    let argList = `${this.params}`
    argList = argList.replace(/,/g, ' ')
    return `Closure (${this.meta.id} ${argList}) Expr {env}`
  }

  // refactor: let function itself decide whether to evaluate the arguments
  // call(args: Value[], location: string): Either<Value, string> {
  call(argEnv: Env, args: Parser.Expr[], location: string): Either<Value, string> {
    if (args.length !== this.params.length) {
      return new Right(`number of arguments: function '${this.meta.id}' defined${this.meta.location}: expected ${this.params.length}, got ${args.length}${location}${formatStackTrace('', argEnv)}`)
    }

    // current: user-defined functions must evaluate arguments in the beginning
    let vals: Value[] = []

    for (let i in args) {
      let val = evaluate(argEnv, args[i])
      if (val.isLeft()) {
        vals.push(val.unwrapLeft())
      } else {
        return val
      }
    }

    let env: Env = this.env
    for (let i in vals) {
      let p = this.params[i]
      let a = vals[i]
      env = env.pushed(this.meta.id, this.meta.location)
      env.set(p, a)
    }

    return evaluate(env, this.body)
  }
}

class BuiltinClosure {
  id: string
  params: string[]
  _call?: (args: Value[], location: string, env?: Env) => Either<Value, string>
  _callExpr?: (argEnv: Env, args: Parser.Expr[], location: string, env?: Env) => Either<Value, string>

  constructor(
    id: string,
    params: string[],
    call?: (args: Value[], location: string, env?: Env) => Either<Value, string>,
    callExpr?: (argEnv: Env, args: Parser.Expr[], location: string, env?: Env) => Either<Value, string>
  ) {
    this.id = id
    this.params = params
    this._call = call
    this._callExpr = callExpr
  }

  call(argEnv: Env, args: Parser.Expr[], location: string): Either<Value, string> {
    if (args.length !== this.params.length) {
      return new Right(`number of arguments: function '${this.id}': expected ${this.params.length}, got ${args.length}${location}${formatStackTrace('', argEnv)}`)
    }

    if (this === boolTrue) {
      return evaluate(argEnv, args[0])
    } else if (this === boolFalse) {
      return evaluate(argEnv, args[1])
    }

    if (this._call !== undefined) {
      let vals: Value[] = []

      for (let i in args) {
        let val = evaluate(argEnv, args[i])
        if (val.isLeft()) {
          vals.push(val.unwrapLeft())
        } else {
          return val
        }
      }

      return this._call(vals, location, argEnv)
    } else if (this._callExpr !== undefined) {
      return this._callExpr(argEnv, args, location, argEnv)
    } else {
      throw new Error('not possible')
    }
  }

  toString(): string {
    return this.id
  }
}

const boolTrue: Value = new BuiltinClosure('#t', ['$0', '$1'], (args, _) => {
  return new Left(args[0])
})

const boolFalse: Value = new BuiltinClosure('#f', ['$0', '$1'], (args, _) => {
  return new Left(args[1])
})

function isBool(v: Value): boolean {
  return v === boolTrue || v === boolFalse
}

function showValueType(v: Value): string {
  return typeof v === 'number' ? 'Number' :
    typeof v === 'string' ? 'String' :
    isBool(v) ? 'Boolean' :
    v instanceof Unit ? '()' :
    v instanceof List ? 'List' :
    v instanceof Dict ? 'Dict' :
    v instanceof Closure ? 'Function' :
    v instanceof BuiltinClosure ? 'Function' :
      '(unknown)'
}

export const BUILTINS: {[keys: string]: () => Value} = {
  'add': () =>
    new BuiltinClosure('add', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l + r)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l + r)
      } else if (l instanceof List && r instanceof List) {
        return new Left(new List(l.values.concat(r.values)))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'add'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'sub': () =>
    new BuiltinClosure('sub', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l - r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'sub'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'mul': () =>
    new BuiltinClosure('mul', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l * r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'mul'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'div': () =>
    new BuiltinClosure('div', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l / r)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(path.join(l, r).replace(/\\/g, '/'))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'div'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'mod': () =>
    new BuiltinClosure('mod', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l % r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'mod'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'band': () =>
    new BuiltinClosure('band', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l & r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'band'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'bor': () =>
    new BuiltinClosure('bor', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l | r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'bor'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'bxor': () =>
    new BuiltinClosure('bxor', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l ^ r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'bxor'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'bcom': () =>
    new BuiltinClosure('add', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(~l)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'bcom'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  '<<': () =>
    new BuiltinClosure('<<', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l << r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for '<<'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  '>>': () =>
    new BuiltinClosure('>>', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l >> r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for '>>'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  '#t': () => boolTrue
  ,
  '#f': () => boolFalse
  ,
  '=': () =>
    new BuiltinClosure('=', ['$0', '$1'], (args, _) => {
      let [l, r] = args
      return new Left(l === r ? boolTrue : boolFalse)
    })
  ,
  '!=': () =>
    new BuiltinClosure('!=', ['$0', '$1'], (args, _) => {
      let [l, r] = args
      return new Left(l !== r ? boolTrue : boolFalse)
    })
  ,
  'lt': () =>
    new BuiltinClosure('lt', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l < r ? boolTrue : boolFalse)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l < r ? boolTrue : boolFalse)
      } else if (l instanceof List && r instanceof List) {
        return new Left(l < r ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'lt'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'gt': () =>
    new BuiltinClosure('gt', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l > r ? boolTrue : boolFalse)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l > r ? boolTrue : boolFalse)
      } else if (l instanceof List && r instanceof List) {
        return new Left(l > r ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'gt'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'le': () =>
    new BuiltinClosure('le', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l <= r ? boolTrue : boolFalse)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l <= r ? boolTrue : boolFalse)
      } else if (l instanceof List && r instanceof List) {
        return new Left(l <= r ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'le'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'ge': () =>
    new BuiltinClosure('ge', ['$0', '$1'], (args, location, env) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l >= r ? boolTrue : boolFalse)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l >= r ? boolTrue : boolFalse)
      } else if (l instanceof List && r instanceof List) {
        return new Left(l >= r ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'ge'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  '#int': () =>
    new BuiltinClosure('#int', ['$0'], (args, location, env) => {
      return new Right('not implemented: #int')
    })
  ,
  'trunc': () =>
    new BuiltinClosure('trunc', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.trunc(l))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'trunc'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'floor': () =>
    new BuiltinClosure('floor', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.floor(l))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'floor'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'ceil': () =>
    new BuiltinClosure('ceil', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.ceil(l))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'ceil'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'round': () =>
    new BuiltinClosure('round', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.round(l))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'round'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'abs': () =>
    new BuiltinClosure('abs', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.abs(l))
      } else if (typeof l === 'string') {
        return new Left(path.resolve(l).replace(/\\/g, '/'))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'abs'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'show': () =>
    new BuiltinClosure('show', ['$0'], (args, location, env) => {
      let [l] = args
      return new Left(`${l}`)
    })
  ,
  'repr': () =>
    new BuiltinClosure('repr', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'string') {
        return new Left(`"${l}"`)
      } else if (l instanceof Dict) {
        return new Left(l.repr())
      } else {
        return new Left(`${l}`)
      }
    })
  ,
  'parse': () =>
    new BuiltinClosure('parse', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'string') {
        let f = parseFloat(l)
        if (isNaN(f)) {
          throw new Error('number NaN')
        } else {
          return new Left(parseFloat(l))
        }
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'parse'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'chars': () =>
    new BuiltinClosure('chars', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'string') {
        return new Left(new List(l.split('')))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'chars'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'empty?': () =>
    new BuiltinClosure('empty?', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'string') {
        return new Left(l.length === 0 ? boolTrue : boolFalse)
      } else if (l instanceof List) {
        return new Left(l.values.length === 0 ? boolTrue : boolFalse)
      } else if (l instanceof Dict) {
        return new Left(l.data.size === 0 ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'empty?'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'len': () =>
    new BuiltinClosure('len', ['$0'], (args, location, env) => {
      let [l] = args
      if (typeof l === 'string') {
        return new Left(l.length)
      } else if (l instanceof List) {
        return new Left(l.values.length)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'len'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'slice': () =>
    new BuiltinClosure('slice', ['iter', 'start', 'end'], (args, location, env) => {
      let [iter, st, ed] = args
      if (typeof iter === 'string' && typeof st === 'number' && typeof ed === 'number') {
        return new Left(iter.slice(st, ed))
      } else if (iter instanceof List && typeof st === 'number' && typeof ed === 'number') {
        return new Left(new List(iter.values.slice(st, ed)))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(iter)} ${showValueType(st)} ${showValueType(ed)}) for 'slice'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'del-ins': () =>
    new BuiltinClosure('del-ins', ['list', 'start', 'del-count', 'new-items'], (args, location, env) => {
      let [list, st, dc, ni] = args
      if (list instanceof List && typeof st === 'number' && typeof dc === 'number' && ni instanceof List) {
        list.values.splice(st, dc, ...ni.values)
        return new Left(list)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)} ${showValueType(st)} ${showValueType(dc)} ${showValueType(ni)}) for 'del-ins'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'get': () =>
    new BuiltinClosure('get', ['obj', 'attr'], (args, location, env) => {
      let [obj, attr] = args
      if (typeof obj === 'string' && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.length) {
          return new Right(`index out of range: ${attr} of String "${obj}"${location}${formatStackTrace('', env)}`)
        }
        return new Left(obj[attr])
      } else if (obj instanceof List && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.values.length) {
          return new Right(`index out of range: ${attr} of ${obj}${location}${formatStackTrace('', env)}`)
        }
        return new Left(obj.values[attr])
      } else if (obj instanceof Dict) {
        let v = obj.data.get(attr)
        if (v === undefined) {
          return new Right(`key error: key '${attr}' not existing on ${obj}${location}${formatStackTrace('', env)}`)
        }
        return new Left(v)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(obj)} ${showValueType(attr)}) for 'get'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'tryget': () =>
    new BuiltinClosure('add', ['$0', '$1'], (args, location, env) => {
      let [obj, attr] = args
      if (typeof obj === 'string' && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.length) {
          return new Left(unit)
        }
        return new Left(obj[attr])
      } else if (obj instanceof List && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.values.length) {
          return new Left(unit)
        }
        return new Left(obj.values[attr])
      } else if (obj instanceof Dict) {
        let v = obj.data.get(attr)
        if (v === undefined) {
          return new Left(unit)
        }
        return new Left(v)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(obj)} ${showValueType(attr)}) for 'tryget'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  '.': () =>
    new BuiltinClosure('.', ['obj', 'attr'], undefined, (argEnv, args, location, env) => {
      let [obj, attr] = args
      let objv = evaluate(argEnv, obj)
      if (!objv.isLeft()) {
        return objv
      }
      let dict = objv.unwrapLeft()
      if (!(dict instanceof Dict)) {
        return new Right(`unaccepted arguments types (${showValueType(obj)} <unknown>) for '.'${location}${formatStackTrace('', env)}`)
      }

      let s = ''
      if (typeof attr === 'string') {
        s = attr
      } else if (attr instanceof Parser.Var) {
        s = attr.id
      }

      let v = dict.data.get(s)
      if (v === undefined) {
        return new Right(`key error: key "${s}" not existing on ${obj}${location}${formatStackTrace('', env)}`)
      }
      return new Left(v)
    })
  ,
  'set': () =>
    new BuiltinClosure('set', ['obj', 'attr', 'val'], (args, location, env) => {
      let [obj, attr, val] = args
      if (obj instanceof List && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.values.length) {
          return new Right(`index out of range: ${attr} of ${obj}${location}${formatStackTrace('', env)}`)
        }
        obj.values[attr] = val
        return new Left(obj)
      } else if (obj instanceof Dict) {
        if (!obj.data.has(attr)) {
          return new Right(`key error: key '${attr}' not existing on ${obj}${location}${formatStackTrace('', env)}`)
        }
        obj.data.set(attr, val)
        return new Left(obj)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(obj)} ${showValueType(attr)}) for 'set'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'tryset': () =>
    new BuiltinClosure('tryset', ['obj', 'attr', 'val'], (args, location, env) => {
      let [obj, attr, val] = args
      if (obj instanceof List && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.values.length) {
          return new Left(unit)
        }
        obj.values[attr] = val
        return new Left(obj)
      } else if (obj instanceof Dict) {
        if (!obj.data.has(attr)) {
          return new Left(unit)
        }
        obj.data.set(attr, val)
        return new Left(obj)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(obj)} ${showValueType(attr)}) for 'tryset'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'keys': () =>
    new BuiltinClosure('keys', ['dict'], (args, location, env) => {
      let [dict] = args
      if (dict instanceof Dict) {
        let col: Value[] = []
        let keyIter = dict.data.keys()
        for (let k = keyIter.next(); !k.done; k = keyIter.next()) {
          col.push(k.value)
        }
        return new Left(new List(col))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(dict)}) for 'keys'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'entries': () =>
    new BuiltinClosure('entries', ['dict'], (args, location, env) => {
      let [dict] = args
      if (dict instanceof Dict) {
        let ents: List[] = []
        let keyIter = dict.data.keys()
        for (let k = keyIter.next(); !k.done; k = keyIter.next()) {
          let v = dict.data.get(k.value)
          if (v !== undefined) {
            ents.push(new List([k.value, v]))
          } else {
            throw new Error('not possible')
          }
        }
        return new Left(new List(ents))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(dict)}) for 'entries'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'push': () =>
    new BuiltinClosure('push', ['list', 'val'], (args, location, env) => {
      let [list, val] = args
      if (list instanceof List) {
        list.values.push(val)
        return new Left(list)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)} ${showValueType(val)}) for 'push'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'pop': () =>
    new BuiltinClosure('pop', ['list'], (args, location, env) => {
      let [list] = args
      if (list instanceof List) {
        if (list.values.length <= 0) {
          return new Right(`popping from empty list${location}${formatStackTrace('', env)}`)
        }
        let val = list.values.pop()
        if (val !== undefined) {
          return new Left(val)
        } else {
          throw new Error('not possible')
        }
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)}) for 'pop'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'push-front': () =>
    new BuiltinClosure('push-front', ['list', 'val'], (args, location, env) => {
      let [list, val] = args
      if (list instanceof List) {
        list.values.unshift(val)
        return new Left(list)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)} ${showValueType(val)}) for 'push-front'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'pop-front': () =>
    new BuiltinClosure('pop-front', ['list'], (args, location, env) => {
      let [list] = args
      if (list instanceof List) {
        if (list.values.length <= 0) {
          return new Right(`popping from empty list${location}${formatStackTrace('', env)}`)
        }
        let val = list.values.pop()
        if (val !== undefined) {
          return new Left(val)
        } else {
          throw new Error('not possible')
        }
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)}) for 'pop-front'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'print': () =>
    new BuiltinClosure('print', ['x'], (args, location, env) => {
      let [x] = args
      process.stdout.write(`${x}`)
      return new Left(unit)
    })
  ,
  'println': () =>
    new BuiltinClosure('println', ['x'], (args, location, env) => {
      let [x] = args
      process.stdout.write(`${x}\n`)
      return new Left(unit)
    })
  ,
  'type': () =>
    new BuiltinClosure('type', ['x'], (args, location, env) => {
      let [x] = args
      return new Left(showValueType(x))
    })
  ,
  'type-is': () =>
    new BuiltinClosure('type-is', ['x', 'T'], (args, location, env) => {
      let [x, t] = args
      if (typeof t === 'string') {
        return new Left(showValueType(x) === t)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(t)}) for 'type-is'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  // short-cut
  'and': () =>
    new BuiltinClosure('and', ['x', 'y'], undefined, (argEnv, args, location, env) => {
      let [xe, ye] = args
      let x = evaluate(argEnv, xe)
      if (!x.isLeft()) {
        return x
      }
      if (!isBool(x)) {
        return new Right(`unaccepted arguments types (${showValueType(x)} <unknown>) for 'and'${location}${formatStackTrace('', env)}`)
      }
      if (x === boolFalse) {
        return new Left(boolFalse)
      } else {
        let y = evaluate(argEnv, ye)
        if (!y.isLeft()) {
          return y
        }
        if (!isBool(y)) {
          return new Right(`unaccepted arguments types (${showValueType(x)} ${showValueType(y)}) for 'and'${location}${formatStackTrace('', env)}`)
        }
        if (x === boolFalse) {
          return new Left(boolFalse)
        } else {
          return new Left(boolTrue)
        }
      }
    })
  ,
  // short-cut
  'or': () =>
    new BuiltinClosure('or', ['x', 'y'], undefined, (argEnv, args, location, env) => {
      let [xe, ye] = args
      let x = evaluate(argEnv, xe)
      if (!x.isLeft()) {
        return x
      }
      if (!isBool(x)) {
        return new Right(`unaccepted arguments types (${showValueType(x)} <unknown>) for 'or'${location}${formatStackTrace('', env)}`)
      }
      if (x === boolTrue) {
        return new Left(boolTrue)
      } else {
        let y = evaluate(argEnv, ye)
        if (!y.isLeft()) {
          return y
        }
        if (!isBool(y)) {
          return new Right(`unaccepted arguments types (${showValueType(x)} ${showValueType(y)}) for 'or'${location}${formatStackTrace('', env)}`)
        }
        if (x === boolFalse) {
          return new Left(boolFalse)
        } else {
          return new Left(boolTrue)
        }
      }
    })
  ,
  'not': () =>
    new BuiltinClosure('not', ['x'], (args, location, env) => {
      let [x] = args
      if (x === boolFalse) {
        return new Left(boolTrue)
      } else if (x === boolTrue) {
        return new Left(boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(x)}) for 'not'${location}${formatStackTrace('', env)}`)
      }
    })
  ,
  'eval': () =>
    new BuiltinClosure('eval', ['src'], (args, location, env) => {
      let [src] = args
      if (typeof src !== 'string') {
        return new Right(`expected argument type (String) for 'eval'${location}${formatStackTrace('', env)}`)
      }
      // if (env === undefined) {
      //   throw new Error('empty env on BuiltinClosure call')
      // }

      let parseResult = new Parser.Parser('(eval)', src).parse()
      if (!parseResult.isLeft()) {
        return new Right(parseResult.unwrapRight())
      }
      let exprs = parseResult.unwrapLeft()

      let vals: Value[] = []
      for (let i in exprs) {
        if (env === undefined) {
          env = new Env()
        }
        let evalResult = evaluate(env, exprs[i])
        if (evalResult.isLeft()) {
          vals.push(evalResult.unwrapLeft())
        } else {
          return evalResult
        }
      }

      return new Left(vals[vals.length - 1])
    })
  ,
  '$': () =>
    new BuiltinClosure('$', ['relpath'], undefined, (argEnv, args, location, env) => {
      let [relpath] = args
      let pathStr = ''
      if (typeof relpath === 'string') {
        pathStr = relpath
      } else if (relpath instanceof Parser.Var) {
        pathStr = relpath.id
      } else {
        return new Right(`expected a string or identifier for '$'${location}${formatStackTrace('', env)}`)
      }

      let file = new FileHandler(pathStr)
      return new Left(file)
    })
  ,
  'read': () =>
    new BuiltinClosure('read', ['file'], (args, location, env) => {
      let [file] = args
      let hdl: FileHandler
      if (typeof file === 'string') {
        hdl = new FileHandler(file)
      } else if (file instanceof FileHandler) {
        hdl = file
      } else {
        return new Right(`expected a path or a FileHandler for 'read'${location}${formatStackTrace('', env)}`)
      }

      let content = hdl.read()
      if (content === undefined) {
        return new Left(unit)
      } else {
        return new Left(content)
      }
    })
  ,
  'import': () =>
    new BuiltinClosure('import', ['file'], (args, location, env) => {
      let [file] = args
      let hdl: FileHandler
      if (typeof file === 'string') {
        hdl = new FileHandler(file)
      } else if (file instanceof FileHandler) {
        hdl = file
      } else {
        return new Right(`expected a path or a FileHandler for 'read'${location}${formatStackTrace('', env)}`)
      }

      let mod = hdl.import()
      if (mod === undefined) {
        return new Left(unit)
      } else {
        return new Left(mod)
      }
    })
  ,
  '__stack__': () =>
    new BuiltinClosure('__stack__', [], (_args, _location, env) => {
      if (env === undefined) {
        return new Left(unit)
      } else {
        return new Left(formatStackTrace('', env))
      }
    })
  ,
}

class Env {
  name: string
  entryLocation?: string
  context: Map<string, Value>
  next: Env | undefined

  constructor(name?: string, entryLocation?: string, next?: Env) {
    this.name = name === undefined || name === '' ? '(anonymous)' : name
    this.entryLocation = entryLocation
    this.context = new Map()
    this.next = next
  }

  pushed(name?: string, entryLocation?: string): Env {
    return new Env(name, entryLocation, this)
  }

  /**
   * Tests whether the top context has an entry of the id.
   */
  topHas(id: string): boolean {
    return this.context.has(id)
  }

  set(id: string, value: Value): this {
    if (this.context.has(id)) {
      // in current version, let defines and reassigns variables. may change in future
      this.context.set(id, value)
      return this
    } else {
      this.context.set(id, value)
      return this
    }
  }

  lookup(id: string): Value | undefined {
    let env: Env | undefined = this
    while (env !== undefined) {
      let context = env.context
      if (context.has(id)) {
        return context.get(id)
      }
      env = env.next
    }

    return undefined
  }
}

function loadPrelude(env: Env) {
  let libpath = process.env['RISP_LIB']
  if (libpath === undefined) {
    console.error('fatal error: environment variable \'RISP_LIB\' is not defined; prelude is not imported')
    return
  }

  let source = ''
  try {
    source = fs.readFileSync(path.join(libpath, 'prelude.risp')).toString()
  } catch (e) {
    console.error('fatal error: prelude file is not found or cannot be read; prelude is not imported')
    return
  }

  const parser = new Parser.Parser('__prelude__', source)
  let ast = parser.parse()
  if (ast.isLeft()) {
    let exprs = ast.unwrapLeft()
    for (let i = 0; i < exprs.length; i++) {
      let val = evaluate(env, exprs[i])
      if (!val.isLeft()) {
        throw new Error('evaluation of prelude failed: ' + ast.unwrapRight())
      }
    }
  } else {
    throw new Error('parse of prelude failed: ' + ast.unwrapRight())
  }
}

var /*DO NOT MODIFY*/ INITIAL_ENV = makeInitialEnv()

function makeInitialEnv(): Env {
  let env = new Env('__main__')

  for (let id in BUILTINS) {
    env.set(id, BUILTINS[id]())
  }

  loadPrelude(env)

  return env
}

function formatStackTrace(errMsg: string, stack?: Env): string {
  if (stack === undefined) return errMsg

  let env: Env | undefined = stack
  errMsg += '\nTrace\n'
  while (env !== undefined) {
    errMsg += `  ${env.name}` + (env.entryLocation === undefined ? '' : env.entryLocation) + '\n'
    // let context = env.context
    // let keys = context.keys()
    // for (let id = keys.next(); !id.done; id = keys.next()) {
    //   errMsg += `    ${id.value}: ${context.get(id.value)}\n`
    // }
    env = env.next
  }
  return errMsg
}

export function execute(filepath: string, source: string): Either<Value[], string> {
  const parser = new Parser.Parser(filepath, source)
  let ast = parser.parse()
  return ast.handle<Either<Value[], string>>(
    exprs => {
      let env = makeInitialEnv()
      let vals: Value[] = []
      for (let i = 0; i < exprs.length; i++) {
        let val = evaluate(env, exprs[i])
        if (val.isLeft()) {
          vals.push(val.unwrapLeft())
          // console.log('Internal result: ' + val.unwrapLeft()) // DEBUG
        } else {
          return new Right(val.unwrapRight())
        }
      }
      return new Left(vals)
    },
    err => new Right(err)
  )
}

const interpretEnv = makeInitialEnv()
// executes, but preserves the environment
export function interpret(source: string): Either<Value[], string> {
  const parser = new Parser.Parser('__repl__', source)
  let ast = parser.parse()
  return ast.handle<Either<Value[], string>>(
    exprs => {
      let vals: Value[] = []
      for (let i = 0; i < exprs.length; i++) {
        let val = evaluate(interpretEnv, exprs[i])
        if (val.isLeft()) {
          vals.push(val.unwrapLeft())
        } else {
          return new Right(val.unwrapRight())
        }
      }
      return new Left(vals)
    },
    err => new Right(err)
  )
}

function evaluate(env: Env, expr: Parser.Expr): Either<Value, string> {
  if (typeof expr === 'number') { // => Number
    return new Left(expr)
  } else if (typeof expr === 'string') { // => String
    return new Left(expr)
  } else if (expr instanceof Parser.Var) { // => *
    let val = env.lookup(expr.id)
    if (val === undefined) {
      return new Right(`undefined variable '${expr.id}'${expr.location}${formatStackTrace('', env)}`)
    } else {
      return new Left(val)
    }
  } else if (expr instanceof Parser.SExpr) {
    let caller = expr.caller
    if (caller === undefined) {
      return new Left(unit)
    } else {
      let callerVal = evaluate(env, caller)
      if (callerVal.isLeft()) {
        let clos = callerVal.unwrapLeft()
        if (clos instanceof Closure || clos instanceof BuiltinClosure) {
          // let functions themselves decide whether to evaluate the arguments
          return clos.call(env, expr.args, expr.location)
        } else if (clos instanceof FileHandler) {
          // ($ file) --good --bad -tax File.c -o a.out
          let cmd = ''
          for (let i in expr.args) {
            let arg = expr.args[i]
            if (typeof arg === 'number') {
              cmd += ` ${arg}`
            } else if (typeof arg === 'string') {
              cmd += ` ${arg}`
            } else if (arg instanceof Parser.Var) {
              cmd += ` ${arg.id}`
            } else if (arg instanceof FileHandler) {
              cmd += ` ${arg.abspath}`
            } else {
              let argv = evaluate(env, arg)
              if (!argv.isLeft()) {
                return argv
              }
              let a = argv.unwrapLeft()
              if (typeof a === 'number') {
                cmd += ` ${a}`
              } else if (typeof a === 'string') {
                cmd += ` ${a}`
              } else if (a instanceof FileHandler) {
                cmd += ` ${a.abspath}`
              } else {
                return new Right(`unsupported command line argument '${a}'${expr.location}`)
              }
            }
          }

          let result = clos.exec(cmd)
          if (result === undefined) {
            return new Left(unit)
          } else {
            return new Left(result)
          }
        } else {
          return new Right(`not callable: result of the first item of this s-expression is not a closure${expr.location}; result was ${clos}${formatStackTrace('', env)}`)
        }
      } else {
        return callerVal
      }
    }
  } else if (expr instanceof Parser.ListExpr) {
    let vals: Value[] = []

    for (let i = 0; i < expr.items.length; i++) {
      let item = expr.items[i]
      let val = evaluate(env, item)
      if (val.isLeft()) {
        vals.push(val.unwrapLeft())
      } else {
        return val
      }
    }

    return new Left(new List(vals))
  } else if (expr instanceof Parser.DictExpr) {
    let map: Map<Value, Value> = new Map()

    for (let i = 0; i < expr.entries.length; i++) {
      let entry = expr.entries[i]
      let keyVal = evaluate(env, entry.key)
      let valVal = evaluate(env, entry.value)
      if (keyVal.isLeft() && valVal.isLeft()) {
        map.set(keyVal.unwrapLeft(), valVal.unwrapLeft())
      } else {
        if (!keyVal.isLeft()) {
          return keyVal
        } else {
          return valVal
        }
      }
    }

    return new Left(new Dict(map))
  } else if (expr instanceof Parser.ExprLetVar) {
    let bodyVal = evaluate(env, expr.expr)
    if (bodyVal.isLeft()) {
      env.set(expr.id, bodyVal.unwrapLeft())
      return new Left(bodyVal.unwrapLeft())
    } else {
      return new Right(bodyVal.unwrapRight())
    }
  } else if (expr instanceof Parser.ExprLetFunc) {
    let clos = new Closure(
      new ClosureMeta(expr.id, expr.location),
      env,
      expr.params,
      expr.body
    )
    env.set(expr.id, clos)
    return new Left(clos)
  } else if (expr instanceof Parser.ExprLambda) {
    let clos = new Closure(
      new ClosureMeta('(lambda)', expr.location),
      env,
      expr.args,
      expr.body
    )
    return new Left(clos)
  } else if (expr instanceof Parser.ExprDo) {
    let exprs = expr.exprs
    let v: Either<Value, string> = new Right('never here')
    for (let i = 0; i < exprs.length; i++) {
      let e = exprs[i]
      v = evaluate(env, e)
      if (!v.isLeft()) {
        return v
      }
    }
    return v
  } else if (expr instanceof Parser.ExprExec) {
    let exprs = expr.exprs
    let values: Value[] = []
    for (let i in exprs) {
      let e = exprs[i]
      let v = evaluate(env, e)
      if (!v.isLeft()) {
        return v
      } else if (typeof v.unwrapLeft() !== 'string') {
        return new Right(`expected string value for '@'${expr.location}`)
      }
      values.push(v.unwrapLeft())
    }

    let cmd = values.join(' ')
    let result = ''
    try {
      result = proc.execSync(cmd).toString()
    } catch (e) {
      console.error(e)
      return new Right(`error while executing command '${cmd}'${expr.location}`)
    }

    process.stdout.write(result)
    return new Left(result)
  } else if (expr instanceof Parser.Macro) {
    // macro definition
    return new Left(unit)
  } else {
    throw new Error('never here')
  }
}
