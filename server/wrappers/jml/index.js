'use strict'

const execa = require('execa')
const tempy = require('tempy')
const path = require('path')
const fs = require('fs')
const generateControlFile = require('./ctl')

// TODO:
// - take aligned fasta filepath
// - hash sequence identifiers with sha256.substr(0, 10) for phylip
// 		- keep the (a) sequence identifier in the phylip hashed ident
// - fasta-to-phylip
// - modify species names in nexus species.trees file to match hashed files
// - fill out ctl file with hashed names
// - run jml
// - read output files
// - reverse hashed names in output files
// - return useful data from files

const readFileOr = (filepath, orValue) => {
	try {
		return fs.readFileSync(filepath, 'utf-8')
	} catch (err) {
		if (err.code === 'ENOENT') {
			return orValue
		}
	}
}

module.exports = jml
async function jml({ phylipData, trees, phylipMapping }) {
	let workDir = tempy.directory()

	let phylipFile = path.join(workDir, 'input.phy')
	fs.writeFileSync(phylipFile, phylipData, 'utf-8')

	let treesFile = path.join(workDir, 'input.species.trees')
	fs.writeFileSync(treesFile, trees, 'utf-8')

	let controlFile = path.join(workDir, 'jml.input.ctl')
	let controlData = generateControlFile(phylipData)
	fs.writeFileSync(controlFile, controlData, 'utf-8')

	// find binary via `which`
	let executable = execa.sync('which', ['jml']).stdout

	// prettier-ignore
	let args = [
		'-c', controlFile,
		'-t', treesFile,
		'-d', phylipFile,
	]

	let result = execa(executable, args, {
		cwd: workDir,
	})

	result.stdout.pipe(process.stderr)
	result.stderr.pipe(process.stderr)

	await result

	process.stderr.write(execa.sync('ls', ['-l', workDir]).stdout)

	let distributions = readFileOr(path.join(workDir, 'Distributions.txt'), '')
	let probabilities = readFileOr(path.join(workDir, 'Probabilities.txt'), '')
	let results = readFileOr(path.join(workDir, 'Results.txt'), '')

	return { distributions, probabilities, results }

	// yield [
	// 	{
	// 		species: ['lup', 'lap'],
	// 		sequences: ['lup1', 'lap1'],
	// 		distance: 0.0162455,
	// 		probability: 0.0434783,
	// 	}
	// ]
}
