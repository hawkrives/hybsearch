'use strict'

const combs = require('combinations-generator')
const uniqBy = require('lodash/uniqBy')
const { removeNodes } = require('../lib/prune-newick')
const countBy = require('lodash/countBy')
const groupBy = require('lodash/groupBy')
const maxBy = require('lodash/maxBy')

const ENABLE_DEBUG = false
let debug = ENABLE_DEBUG ? console.log.bind(console) : () => {}

let label = node => `${node.name} (${node.ident})`
const LABEL_DIVIDER = '__'

// Given a root node, will make sure all the names are split into `name` and `ident`
function fixTreeNames(node) {
	if (node.branchset) {
		// If it's a not a leaf, keep going
		for (let branch of node.branchset) {
			fixTreeNames(branch)
		}
	} else if (node.name && !node.ident) {
		// If it's a leaf, and has a name, but not ident, split it up!
		let splitted = node.name.split(LABEL_DIVIDER)
		node.name = splitted[0]
		node.ident = splitted[1]
	}
}

module.exports.strictSearch = strictSearch
function strictSearch(rootNode) {
	fixTreeNames(rootNode)

	let results = recursiveSearch(rootNode)

	// We don't report all the hybrids found as hybrids just yet
	let hybridSpeciesByName = groupBy(results.nm, h => h.name)
	let totalHybridSpecies = Object.keys(hybridSpeciesByName).length

	// For each species found (if at least 2)
	if (totalHybridSpecies > 1) {
		results.nm = removeHybridSpecies(rootNode, results.nm, hybridSpeciesByName)
	}

	// Count number of hybrids for each species
	let hybridSpeciesCount = countBy(results.nm, h => h.name)

	// Count number of individuals in each species
	let allIndividuals = getAllIndividuals(rootNode)
	let totalSpeciesCount = countBy(allIndividuals, individual => individual.name)

	for (let speciesName in hybridSpeciesCount) {
		if (hybridSpeciesCount[speciesName] === totalSpeciesCount[speciesName]) {
			// We need to unflag the one that's furthest away from its closest
			let matchingHybrids = results.nm.filter(h => h.name === speciesName)
			let furthestHybrid = maxBy(matchingHybrids, h => h.length)

			// furthestHybrid should be removed
			results.nm = results.nm.filter(h => h.ident !== furthestHybrid.ident)
		}
	}

	return results
}

function removeHybridSpecies(rootNode, nonmonophyly, hybridSpeciesByName) {
	let totalHybridSpecies = Object.keys(hybridSpeciesByName).length
	let unflag = []

	for (let hybrids of Object.values(hybridSpeciesByName)) {
		// remove the flagged hybrids and redo the search.
		let rootNodeCopy = JSON.parse(JSON.stringify(rootNode))
		removeNodes(rootNodeCopy, hybrids.map(h => h.ident))
		let resultsRedo = recursiveSearch(rootNodeCopy)

		//  If what remains is N-1 hybrid species, then that was a true hybrid
		let newSpeciesNames = new Set(resultsRedo.nm.map(h => h.name))
		let newSpeciesCount = newSpeciesNames.size

		// if less, then that is NOT a true hybrid. Unmark those.
		if (newSpeciesCount < totalHybridSpecies - 1) {
			// This species is a true nonmonophyly!
		} else {
			// Unflag this species
			unflag = [...unflag, ...hybrids.map(h => h.ident)]
		}
	}

	return nonmonophyly.filter(h => !unflag.includes(h.ident))
}

function getAllIndividuals(rootNode) {
	let allIndividuals = []

	function recurse(node) {
		if (!node.branchset) {
			allIndividuals.push(node)
		} else {
			node.branchset.forEach(recurse)
		}
	}

	recurse(rootNode)

	return allIndividuals
}

// Given a node, it will return {species:[],nm:[]}
// where `species` is a list of individuals under that node
// and `nm` is a list of flagged hybrids
function recursiveSearch(node, nmInstances = []) {
	if (!node.branchset) {
		debug(`no branchset, name: ${node.name}, ident: ${node.ident}`)
		return { species: [node], nm: nmInstances }
	}

	debug('has branchset')
	let combinations = combs(node.branchset, 2)

	let speciesList = []
	let forRemoval = []
	for (let speciesSet of combinations) {
		// if species is in speciesList: continue
		let resultsA = recursiveSearch(speciesSet[1], nmInstances)
		let speciesListA = resultsA.species

		let resultsB = recursiveSearch(speciesSet[0], nmInstances)
		let speciesListB = resultsB.species

		debug('speciesListA:', speciesListA, 'speciesListB', speciesListB)

		const speciesChecker = otherSpeciesList => species1 => {
			let otherSpeciesNames = otherSpeciesList.map(s => s.name)

			let hasName = otherSpeciesNames.includes(species1.name)
			let notAllEqual = !otherSpeciesNames.every(n => n === species1.name)
			debug(`included: ${hasName}; not all equal: ${notAllEqual}`)

			if (hasName && notAllEqual) {
				otherSpeciesList
					.filter(species3 => species3.name === species1.name)
					.forEach(species3 => {
						let count = nmInstances.filter(sp => sp === species3).length

						if (count) {
							return
						}

						debug(`nonmonophyly: ${label(species3)}`)
						debug(`removing from A ${label(species3)}`)
						nmInstances.push(species3)
						forRemoval.push(species3.ident)
					})
			}
		}

		speciesListA.forEach(speciesChecker(speciesListB))
		speciesListA = speciesListA.filter(n => !forRemoval.includes(n.ident))

		speciesListB.forEach(speciesChecker(speciesListA))
		speciesListB = speciesListB.filter(n => !forRemoval.includes(n.ident))

		speciesList = [...speciesList, ...speciesListA, ...speciesListB]
	}

	speciesList = uniqBy(speciesList, 'ident')

	debug('speciesList', speciesList)
	return { species: speciesList, nm: nmInstances }
}

module.exports.formatData = formatData
function formatData(results) {
	const { nm: nmlist } = results
	return nmlist.map(label).join('\n')
}
