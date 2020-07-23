import * as fs from 'fs'
import { execute } from './semantics'

function main() {
  const argv = process.argv
  if (argv.length > 2) {
    const source = fs.readFileSync(argv[2]).toString()
    let values = execute(source)
    values.handle(
      vals => {
        for (let i in vals) {
          console.log(`${vals[i]}`)
        }
      },
      err => console.error(err)
    )
  } else {
    console.error('fatal error: no input file')
  }
}

main()
