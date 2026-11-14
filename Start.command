#!/bin/zsh
cd "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  node dev.mjs
elif [[ -x '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node' ]]; then
  '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node' dev.mjs
else
  echo 'Install Node.js 22 or later, then run: node dev.mjs'
  read '?Press Return to close.'
fi
