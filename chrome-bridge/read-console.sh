#!/bin/bash
# Chrome Remote Debugger Console Reader
# 
# Usage examples:
#   ./read-console.sh                    # Navigate to http://localhost:8080/ and listen for 6 seconds
#   ./read-console.sh --time 10          # Listen for 10 seconds
#   ./read-console.sh --time 30          # Listen for 30 seconds
#   node check-console.js                # Reload current page and listen for 6 seconds
#   node check-console.js --time 5       # Reload current page and listen for 5 seconds
#   node check-console.js --navigate http://example.com --time 15  # Navigate to URL and listen for 15 seconds

node check-console.js --navigate http://localhost:8080/ "$@"
