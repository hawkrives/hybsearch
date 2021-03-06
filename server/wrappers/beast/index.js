'use strict'

const execa = require('execa')
const tempy = require('tempy')
const path = require('path')
const fs = require('fs')

module.exports = beast
async function beast(data, argv = {}) {
	const dir = tempy.directory()

	const inputName = 'input'
	const inputFile = path.join(dir, `${inputName}.xml`)
	fs.writeFileSync(inputFile, data, 'utf-8')

	// find binary via `which`
	const executable = execa.sync('which', ['beast']).stdout

	// prettier-ignore
	const args = [
		// use as many threads as possible
		// '-threads', -1,
		// change to the working directory of the input file
		'-working',
		// something something
		// '-instances', 10,
		// use beagle if possible
		// '-beagle',
		// provide the input file path
		inputFile,
	]

	// NOTE: if beast finds beagle, it expects opencl to exist as well,
	// and our docker image currently doesn't support that. So, we'll set
	// the beagle search path to a nonexistant folder.
	let result = execa(executable, args, {
		env: {
			BEAGLE_LIB: '/dev/null',
		},
	})

	if (!argv.quiet) {
		result.stdout.pipe(process.stderr)
		result.stderr.pipe(process.stderr)
	}

	await result

	// process.stderr.write(execa.sync('ls', ['-l', dir]).stdout)

	const log = fs.readFileSync(path.join(dir, 'data.log'), 'utf-8')
	const trees = fs.readFileSync(path.join(dir, 'data.trees'), 'utf-8')
	const species = fs.readFileSync(path.join(dir, 'species.trees'), 'utf-8')

	return { log, trees, species }
}
