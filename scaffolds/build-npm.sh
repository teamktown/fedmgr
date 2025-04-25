
#!/bin/bash
set -e

cd src/mcp-core
npm install
npm run sanity
npm pack
echo "✅ MCP Core packaged: $(ls *.tgz)"

cd ../fedmgr
npm install
npm run sanity
npm pack
echo "✅ fedmgr packaged: $(ls *.tgz)"
