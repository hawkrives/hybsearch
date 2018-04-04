'use strict'

const { load, setEntResults } = require('./graph')

const fs = require('fs')

function run() {
	// get the file
	let filepicker = document.querySelector('#load-file')
	let filedropdown = document.querySelector('#pick-file')
	let filepath = filepicker.files.length
		? filepicker.files[0].path
		: filedropdown.value

	console.log(`The file is ${filepath}`)
	const data = fs.readFileSync(filepath, 'utf-8')

	// start the loading bar
	document.querySelector('section.loader').classList.add('loading')

	// start the pipeline
	submitJob({ pipeline: 'search', filepath, data })

	return false
}

function submitJob({ socket = global.socket, pipeline, filepath, data }) {
	const ws = socket

	ws.addEventListener('message', packet => onMessage(packet.data))
	ws.addEventListener('disconnect', (...args) =>
		console.log('disconnect', ...args)
	)
	ws.addEventListener('error', (...args) => console.log('error', ...args))
	ws.addEventListener('exit', (...args) => console.log('exit', ...args))

	if (ws.readyState !== 1) {
		throw new Error('socket not ready!')
	}

	let payload = { type: 'start', pipeline, filepath, data }
	ws.send(JSON.stringify(payload), err => {
		if (err) {
			console.error('server error', err)
			window.alert('server error:', err.message)
		}
	})
}

function onData(phase, data) {
	if (phase.startsWith('newick-json:')) {
		// Once we get the parsed newick tree, we can render the tree while
		// the pipeline continues
		document.querySelector('#phylogram').hidden = false
		load(data)
	} else if (phase === 'pruned-identifiers') {
		let container = document.querySelector('#omitted-results')

		let formattedNames = data.map(node => {
			let ident = node.ident ? ` [${node.ident}]` : ''
			return `${node.name}${ident} (${node.length})`
		})

		container.innerHTML = `<pre>${formattedNames.join('\n')}</pre>`
		container.hidden = false
	} else if (phase === 'nonmonophyletic-sequences') {
		setEntResults(data)
	} else {
		console.warn(`Client doesn't understand data for "${phase}"`)
	}
}

function onMessage(packet) {
	let { type, payload } = JSON.parse(packet)

	if (type === 'stage-start') {
		const { stage } = payload
		beginLoadingStatus(stage)
	} else if (type === 'stage-complete') {
		const { stage, timeTaken, result, cached } = payload
		updateLoadingStatus({
			label: stage,
			duration: timeTaken.toFixed(2),
			usedCache: cached,
		})
		onData(stage, result)
	} else if (type === 'error') {
		let { error, timeTaken } = payload
		console.error(error)
		setLoadingErrors({ after: timeTaken })
		document.querySelector('#error-container').hidden = false
		document.querySelector('#error-message').innerText = error.message
	} else if (type === 'exit') {
		console.info('server exited')
	} else {
		console.warn(`unknown cmd "${type}"`)
	}
}

function attachListeners() {
	document.getElementById('tree-box-submit').addEventListener('click', e => {
		e.preventDefault()

		let data = document.getElementById('tree-box').value
		submitJob({ pipeline: 'parse-newick', filepath: 'input.newick', data })
	})

	document
		.getElementById('json-tree-box-submit')
		.addEventListener('click', e => {
			e.preventDefault()

			let data = document.getElementById('tree-box').value
			load(JSON.parse(data))
		})

	document.getElementById('start').addEventListener('click', e => {
		e.preventDefault()

		run()
	})

	document.getElementById('reload').addEventListener('click', e => {
		e.preventDefault()

		window.location.reload()
	})
}

function updateLoadingStatus({ label, duration, usedCache }) {
	console.info(`finished ${label} in ${duration}ms`)
	let el = document.querySelector(`.checkmark[data-loader-name='${label}']`)
	if (!el) {
		console.error(`could not find .checkmark[data-loader-name='${label}']`)
		return
	}
	el.classList.remove('active')
	el.classList.add('complete')
	usedCache && el.classList.add('used-cache')
	el.dataset.time = duration
}

function beginLoadingStatus(label) {
	console.info(`beginning ${label}`)
	let el = document.querySelector(`.checkmark[data-loader-name='${label}']`)
	if (!el) {
		console.error(`could not find .checkmark[data-loader-name='${label}']`)
		return
	}
	el.classList.add('active')
}

function setLoadingErrors({ after: timeTaken }) {
	let els = document.querySelectorAll(`.checkmark.active`)
	for (let el of els) {
		console.info(`error in ${el.dataset.loaderName}`)
		el.classList.add('error')
		el.dataset.time = timeTaken
	}
}

module.exports = run
module.exports.attachListeners = attachListeners
