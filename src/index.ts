import * as fs from 'fs'
import { execute, interpret } from './semantics'
import { question } from 'readline-sync'

function showGreetings() {
  process.stdout.write(`
Welcome to RumLisp Interactive Console!
  Type :exit  to exit.
  Type :      for help of use.

`)
}

function showHelp() {
  process.stdout.write(`Commands (starts with :)
  :exit           Exit this interactive console.
  :<any other>    Prompt for this help.
  
Or directly type RumLisp expressions to evaluate them and see the results.
`)
}

function repl() {
  showGreetings()
  let cmd = ''
  while (true) {
    // process.stdout.write('> ');
    cmd = question('> ')
    if (cmd.startsWith(':')) {
      if (cmd === ':exit') {
        return
      } else {
        showHelp()
      }
    } else {
      let values = interpret(cmd)
      values.handle(
        vals => {
          for (let i in vals) {
            console.log(`(result) ${vals[i]}`)
          }
        },
        err => console.error(err)
      )
    }
  }
}

function main() {
  const argv = process.argv
  if (argv.length > 2) {
    const source = fs.readFileSync(argv[2]).toString()
    let values = execute(source)
    values.handle(
      _vals => {
      },
      err => console.error(err)
    )
  } else {
    repl()
  }
}

main()
