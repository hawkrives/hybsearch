'use strict'
const { parseFasta } = require('./fasta/parse')

module.exports.fixFastaSource = fixFastaSource
function fixFastaSource(fasta) {
	let data = parseFasta(fasta)

	data = data.map(({ species, sequence }) => {
		let [accession, word1, word2] = species.split(/\s+/)

		accession = accession.replace(/[^a-z0-9_]/gi, 'x')
		if (word1 && word2) {
			species = `${word1}_${word2}__${accession}`
		} else {
			species = accession
		}

		return { species, sequence }
	})

	return data
}
