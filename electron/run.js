// @ts-check
'use strict'

const { parse: parseNewick } = require('../vendor/newick')
const { load } = require('./graph')

const fs = require('fs')
const childProcess = require('child_process')
const path = require('path')

module.exports = run
function run() {
	let filepicker = document.querySelector('#load-file')
	let filedropdown = document.querySelector('#pick-file')
	let filepath = filepicker.files.length
		? filepicker.files[0].path
		: path.join(__dirname, '..', 'data', filedropdown.value)

	console.log('The file is', filepath)

	document.querySelector('section.loader').classList.add('loading')

	let mutableArgs = {
		start: performance.now(),
		label: 'process',
	}
	// let child = childProcess.fork(path.join(__dirname, '..', 'lib', 'worker.js'))

	// still doesn't work.
	// current problem: the calls to execSync in `child`s children
	// don't get the signal.
	// let killChildProcess = () => child.kill()
	// process.on('exit', killChildProcess)
	// window.addEventListener('beforeunload', killChildProcess)

	const ws = new WebSocket('ws://localhost:8080/')

	console.log(ws)

	ws.addEventListener('message', packet => onMessage(packet, mutableArgs))//, child))
	ws.addEventListener('disconnect', console.log.bind(console, 'disconnect'))
	ws.addEventListener('error', console.log.bind(console, 'error'))
	ws.addEventListener('exit', console.log.bind(console, 'exit'))

	ws.addEventListener('open', () => {
		const data = fs.readFileSync(filepath, 'utf-8')
		ws.send(JSON.stringify(['start', filepath, data]), err => {
			if (err) {
				console.error('child error', err)
			}
		})
	})


	return false
}

function onMessage(packet, args, child) {
	let [cmd, msg] = JSON.parse(packet)
	switch (cmd) {
		case 'begin': {
			args.start = performance.now()
			args.label = msg
			beginLoadingStatus(msg)
			break
		}
		case 'complete': {
			let taken = performance.now() - args.start
			updateLoadingStatus(msg, taken.toFixed(2))
			break
		}
		case 'error': {
			console.error(msg)
			console.error(msg.message)
			let taken = performance.now() - args.start
			setLoadingError(args.label, taken.toFixed(2))
			document.querySelector('#error-container').hidden = false
			document.querySelector('#error-message').innerText = msg.message
			// child.disconnect()
			break
		}
		case 'exit': {
			// child.disconnect()
			break
		}
		case 'finish': {
			load(parseNewick(msg))
			break
		}
		default: {
			throw new Error(`unknown cmd "${cmd}"`)
		}
	}
}

document.getElementById('tree-box-submit').addEventListener('click', e => {
	e.preventDefault()
	var data = document.getElementById('tree-box').value
	load(parseNewick(data))
})

document.getElementById('json-tree-box-submit').addEventListener('click', e => {
	e.preventDefault()
	let data = document.getElementById('tree-box').value
	load(JSON.parse(data))
})

function updateLoadingStatus(label, timeTaken) {
	console.info(`finished ${label} in ${timeTaken}ms`)
	let el = document.querySelector(`.checkmark[data-loader-name='${label}']`)
	el.classList.remove('active')
	el.classList.add('complete')
	el.dataset.time = timeTaken
}

function beginLoadingStatus(label) {
	console.info(`beginning ${label}`)
	document
		.querySelector(`.checkmark[data-loader-name='${label}']`)
		.classList.add('active')
}

function setLoadingError(label, timeTaken) {
	console.info(`error in ${label} (after ${timeTaken}ms)`)
	let el = document.querySelector(`.checkmark[data-loader-name='${label}']`)
	el.classList.add('error')
	el.dataset.time = timeTaken
}
