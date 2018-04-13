#!/usr/bin/env node
'use strict'

const STARTED = Date.now()
const WebSocket = require('ws')
const childProcess = require('child_process')
const path = require('path')
const http = require('http')
const Koa = require('koa')
const Router = require('koa-router')
const compress = require('koa-compress')
const logger = require('koa-logger')
const getFiles = require('./lib/get-files')
const { loadFile } = getFiles

const PORT = 8080
const app = new Koa()
const server = http.createServer(app.callback())
const wss = new WebSocket.Server({
	server,
	perMessageDeflate: {},
})

const PIPELINES = require('./pipeline/pipelines')
const router = new Router()

router.get('/', ctx => {
	ctx.body = 'hello, world!'
})

router.get('/pipelines', ctx => {
	ctx.body = { pipelines: Object.keys(PIPELINES) }
})

router.get('/pipeline/:name', ctx => {
	let pipe = PIPELINES[ctx.params.name]
	if (pipe) {
		ctx.body = { steps: pipe }
	} else {
		ctx.throw(404, { error: 'pipeline not found' })
	}
})

router.get('/files', async ctx => {
	ctx.body = { files: await getFiles() }
})

router.get('/file/:name', async ctx => {
	ctx.body = { content: await loadFile(ctx.params.name) }
})

router.get('/uptime', ctx => {
	ctx.body = { uptime: Date.now() - STARTED }
})

app.use(logger())
app.use(compress())
app.use(router.routes())
app.use(router.allowedMethods())

const workerPath = path.join(__dirname, 'pipeline', 'worker.js')

function trimMessage(message) {
	return JSON.parse(
		JSON.stringify(message, (k, v) => {
			if (typeof v === 'string' && v.length > 99) {
				return v.substr(0, 99) + '…'
			}
			return v
		})
	)
}

// listen for new websocket connections
wss.on('connection', ws => {
	console.log('connection initiated')
	const child = childProcess.fork(workerPath)

	ws.on('message', communique => {
		// when we get a message from the GUI
		const message = JSON.parse(communique)

		console.log(trimMessage(message))

		// forward the message to the pipeline
		child.send(message)
	})

	ws.on('close', () => {
		console.log('connection was closed')

		if (child.connected) {
			child.disconnect()
		}
	})

	child.on('message', communique => {
		// when we get a message from the pipeline
		const message = communique

		console.log(trimMessage(message))

		// forward the message to the GUI
		ws.send(JSON.stringify(message))

		// detach ourselves if the pipeline has finished
		if (message.type === 'exit' || message.type === 'error') {
			if (child.connected) {
				child.disconnect()
			}
		}
	})
})

server.listen(PORT)
console.log(`listening on localhost:${PORT}`)
