#!/usr/bin/env node
'use strict'

const child = require('child_process')
const tempfile = require('tempfile')
const fs = require('fs')
const getData = require('./lib_get-data')

module.exports = clustal
function clustal(data) {
	const inputFile = tempfile().replace(' ', '\ ')
	const outputFile = tempfile().replace(' ', '\ ')
	fs.writeFileSync(inputFile, data, 'utf-8')

	const argString = `clustalo --in ${inputFile} --out ${outputFile} --outfmt=fasta`

	child.execSync(argString)

	return fs.readFileSync(outputFile, 'utf-8')
}

function main() {
	let file = process.argv[2]

	if (!file && file !== '-') {
		console.error('usage: node clustal-o.js (<input> | -) [output]')
		process.exit(1)
	}

	getData(file)
		.then(clustal)
		.then(output => {
			if (process.argv.length === 4) {
				fs.writeFileSync(process.argv[3], output, 'utf-8')
			} else {
				console.log(output)
			}
		})
		.catch(console.error.bind(console))
}

if (require.main === module) {
	main()
}
