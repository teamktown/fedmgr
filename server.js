
require('dotenv').config();
const express = require('express')
const path = require('path')
const app = express()

const PORT = process.env.PORT || 5173

// Serve everything inside the public folder
app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`🚀 fedmgr interface running at http://localhost:${PORT}`)
})
