'use strict'

const combs = require('combinations-generator')
const uniqBy = require('lodash/uniqBy')
const countBy = require('lodash/countBy')
const groupBy = require('lodash/groupBy')
const remove = require('lodash/remove')
const { removeNodes } = require('../lib/remove-nodes')
const { getLeafNodes } = require('../lib/get-leaf-nodes')
const { parseFasta } = require('../formats/fasta/parse')
const hammingDistance = require('../hamdis/hamming-distance')

let label = node => `${node.name} (${node.ident})`
const LABEL_DIVIDER = '__'
const makeIdent = node => node.name + LABEL_DIVIDER + node.ident

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

// Builds a dictionary of (species name, ident) -> sequence
function buildSequenceMap(alignedFasta) {
	const fastaData = parseFasta(alignedFasta)
	let dict = {}
	for (let obj of fastaData) {
		dict[obj.species] = obj.sequence
	}
	return dict
}

module.exports.search = search
function search(rootNode, alignedFasta) {
	// Some preprocessing
	fixTreeNames(rootNode)
	let sequenceMap = buildSequenceMap(alignedFasta)

	// The core algorithm
	let results = recursiveSearch(rootNode)
	unflagIfAllAreFlagged(results, rootNode, sequenceMap)
	unflagIfRemovingDoesNotFix(results, rootNode)

	return results
}

module.exports.searchWithNoFilter = searchWithNoFilter
function searchWithNoFilter(rootNode) {
	fixTreeNames(rootNode)
	return recursiveSearch(rootNode)
}

// Given a species name and a tree, find the node under which
// all the individuals of this species lie
function getMostRecentCommonAncestor(rootNode, speciesName) {
	let rootCopy = JSON.parse(JSON.stringify(rootNode))
	// Add parent references to each node
	function addParent(node) {
		if (!node.branchset) {
			return
		}

		for (let child of node.branchset) {
			child.parent = node
		}
		node.branchset.forEach(addParent)
	}

	addParent(rootCopy)

	// Find just one individual of the species
	let allIndividuals = findIndividualsOfSpecies(rootCopy, speciesName)

	if (allIndividuals.length === 0) {
		// This will happen if all the individuals in a species are marked as hybrids
		// this shouldn't happen in general because the filtering step before this
		//  should unflag at least 1
		throw new Error(
			`Attempt to search for species "${speciesName}" which is not in the tree.`
		)
	}

	// Keep going to parent as long as not all the individuals in
	// the species are under this parent
	let individual = allIndividuals[0]
	let leafNodes = findIndividualsOfSpecies(individual, speciesName)
	while (leafNodes.length < allIndividuals.length) {
		individual = individual.parent
		leafNodes = findIndividualsOfSpecies(individual, speciesName)
	}
	return individual
}

function findIndividualsOfSpecies(rootNode, speciesName) {
	return getLeafNodes(rootNode).filter(node => node.name === speciesName)
}

// Given a species and a tree, will return true if all individuals
// in this species are found under the most recent common ancestor, and no other
// individuals are found under this ancestor
function isSpeciesMonophyletic(rootNode, speciesName) {
	// Find the MRCA
	let MCRA = getMostRecentCommonAncestor(rootNode, speciesName)

	// Determine whether everything under that node is of the same species
	let leafNodes = getLeafNodes(MCRA)

	let allEqual = leafNodes.every(n => n.name === speciesName)
	return allEqual
}

// We only want hybrids that, once removed, make their species monophyletic
// Check if all the flagged ones have this property. Otherwise unflag them
function unflagIfRemovingDoesNotFix(results, rootNode) {
	let hybridSpeciesByName = groupBy(results.nm, hybrid => hybrid.name)
	let totalHybridSpecies = Object.keys(hybridSpeciesByName).length

	// For each species found (if at least 2)
	if (totalHybridSpecies <= 1) {
		return
	}

	let unflag = []
	for (let [name, hybrids] of Object.entries(hybridSpeciesByName)) {
		// remove the flagged hybrids and check if their species becomes monophyletic
		let rootNodeCopy = JSON.parse(JSON.stringify(rootNode))
		removeNodes(rootNodeCopy, hybrids.map(h => h.ident))

		// if the species is still nonmono, then we unflag these
		if (!isSpeciesMonophyletic(rootNodeCopy, name)) {
			for (let hybrid of hybrids) {
				unflag.push(hybrid.ident)
			}
		}

		// We also need to check if removing the hybrids of this species made _another_
		// species monophyletic. If it has, then the hybrids in that species are not
		// really hybrids and should be unflagged
		for (let otherName of Object.keys(hybridSpeciesByName)) {
			if (otherName === name) {
				continue
			}
			if (isSpeciesMonophyletic(rootNodeCopy, otherName)) {
				let otherHybrids = hybridSpeciesByName[otherName]
				for (let hybrid of otherHybrids) {
					unflag.push(hybrid.ident)
				}
			}
		}
	}

	remove(results.nm, hybrid => unflag.includes(hybrid.ident))
}

// Given an individual, find the shortest distance to an individiual that is
// not of the same species
function getSmallestInterSpeciesDistance(individual, sequenceMap) {
	let individualSequence = sequenceMap[makeIdent(individual)]
	let shortestDist

	for (let id of Object.keys(sequenceMap)) {
		let speciesName = id.split(LABEL_DIVIDER)[0]
		if (speciesName === individual.name) {
			continue
		}

		let dist = hammingDistance(individualSequence, sequenceMap[id])
		if (shortestDist === undefined || dist < shortestDist) {
			shortestDist = dist
		}
	}

	return shortestDist
}

// Check if we've flagged the entire species. If so, start unflagging
function unflagIfAllAreFlagged(results, rootNode, sequenceMap) {
	let allIndividuals = getLeafNodes(rootNode)

	// Count number of hybrids for each species
	let hybridSpeciesCount = countBy(results.nm, hybrid => hybrid.name)

	// Count number of individuals in each species
	let totalSpeciesCount = countBy(allIndividuals, individual => individual.name)

	for (let speciesName of Object.keys(hybridSpeciesCount)) {
		// If we've flagged every individual in this species
		if (hybridSpeciesCount[speciesName] !== totalSpeciesCount[speciesName]) {
			continue
		}

		// We initially assume we're going to remove everybody
		let collectedHybridIdents = {}
		let toRemove = results.nm
			.filter(hybrid => hybrid.name === speciesName)
			.map(hybrid => hybrid.ident)

		let rootNodeCopy = JSON.parse(JSON.stringify(rootNode))
		let isMono = false

		while (!isMono) {
			// We need to remove the one that's closest to a different species
			// and continue to do this until monophyly is achieved. Those
			// removed ones are the true hybrids. Everyone else is unflagged
			let shortestDist
			let closestHybrid

			results.nm
				.filter(hybrid => hybrid.name === speciesName)
				.filter(hybrid => !collectedHybridIdents[hybrid.ident])
				.forEach(hybrid => {
					let dist = getSmallestInterSpeciesDistance(hybrid, sequenceMap)
					if (shortestDist === undefined) {
						shortestDist = dist
					}
					if (shortestDist <= dist) {
						shortestDist = dist
						closestHybrid = hybrid
					}
				})

			// The closest one to a different species is probably a hybrid, so
			// let's not remove it
			if (closestHybrid === undefined) {
				break
			}

			collectedHybridIdents[closestHybrid.ident] = true
			remove(toRemove, ident => ident === closestHybrid.ident)
			removeNodes(rootNodeCopy, [closestHybrid.ident])

			// Now check if monophyly is achieved, and repeat if not
			isMono = isSpeciesMonophyletic(rootNodeCopy, speciesName)
		}

		// remove all the ones remaining in toRemove
		remove(results.nm, hybrid => toRemove.includes(hybrid.ident))
	}
}

// Given a node, it will return {species:[],nm:[]} where `species` is a list
// of individuals under that node and `nm` is a list of flagged hybrids
function recursiveSearch(node, nmInstances = []) {
	if (!node.branchset) {
		return { species: [node], nm: nmInstances }
	}

	let combinations = combs(node.branchset, 2)

	let speciesList = []
	let forRemoval = []
	for (let speciesSet of combinations) {
		// if species is in speciesList: continue
		let resultsA = recursiveSearch(speciesSet[1], nmInstances)
		let speciesListA = resultsA.species

		let resultsB = recursiveSearch(speciesSet[0], nmInstances)
		let speciesListB = resultsB.species

		const speciesChecker = otherSpeciesList => species1 => {
			const otherSpeciesNames = otherSpeciesList.map(s => s.name)

			let hasName = otherSpeciesNames.includes(species1.name)
			let notAllEqual = !otherSpeciesNames.every(n => n === species1.name)

			if (hasName && notAllEqual) {
				otherSpeciesList
					.filter(species3 => species3.name === species1.name)
					.forEach(species3 => {
						const count = nmInstances.filter(sp => sp === species3).length

						if (!count) {
							nmInstances.push(species3)
							forRemoval.push(species3.ident)
						}
					})
			}
		}

		speciesListA.forEach(speciesChecker(speciesListB))
		remove(speciesListA, n => forRemoval.includes(n.ident))

		speciesListB.forEach(speciesChecker(speciesListA))
		remove(speciesListB, n => forRemoval.includes(n.ident))

		if (speciesListA.length) {
			speciesList.push(...speciesListA)
		}
		if (speciesListB.length) {
			speciesList.push(...speciesListB)
		}
	}

	speciesList = uniqBy(speciesList, 'ident')

	return { species: speciesList, nm: nmInstances }
}

module.exports.formatData = formatData
function formatData(results) {
	const { nm: nmlist } = results
	return nmlist.map(label).join('\n')
}
