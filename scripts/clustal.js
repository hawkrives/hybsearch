#!/usr/bin/env node
'use strict'

const fs = require('fs')
const getData = require('./lib/get-data')

const clustal = require('../bin/clustal')

function main() {
	let argv = process.argv.slice(2)
	let file = argv[0]

	if (!file && process.stdin.isTTY) {
		console.error('usage: node clustal.js (<input> | -) [output]')
		process.exit(1)
	}

	return getData(file)
		.then(clustal)
		.then(output => {
			if (argv[1]) {
				fs.writeFileSync(argv[1], output, 'utf-8')
			} else {
				console.log(output)
			}
		})
		.catch(console.error.bind(console))
}

if (require.main === module) {
	main()
}
