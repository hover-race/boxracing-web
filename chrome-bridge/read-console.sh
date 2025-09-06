#!/bin/bash
# Chrome Remote Debugger Console Reader
# Pass through all options to check-console.js

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run the node script from the script's directory
cd "$SCRIPT_DIR"
node check-console.js "$@"
