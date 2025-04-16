const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const EventEmitter = require('events')
const path = require('path')
const fs = require('fs')

const app = express()
const server = http.createServer(app)
const emitter = new EventEmitter()

const name = process.argv[3]
const port = process.argv[5] || 3100
const baseDir = path.resolve(__dirname, '../../mcp_instances', name)
const telemetryPath = '/ws/telemetry'

const wss = new WebSocket.Server({ server, path: telemetryPath })
wss.on('connection', ws => {
  const listener = log => ws.send(JSON.stringify(log))
  emitter.on('log', listener)
  ws.on('close', () => emitter.off('log', listener))
})

function log(level, event, detail) {
  emitter.emit('log', {
    timestamp: new Date().toISOString(),
    level,
    event,
    detail,
    mcp: name
  })
}

// Simulate token validation
app.get('/api', (req, res) => {
  const token = req.headers.authorization || 'none'
  log('INFO', 'CALL_RECEIVED', `Token received: ${token}`)
  log('INFO', 'VALIDATION_PASSED', `Trust validation passed`)
  res.send(`Hello from ${name}!`)
})

server.listen(port, () => {
  log('INFO', 'MCP_START', `MCP '${name}' running on http://localhost:${port}`)
})
