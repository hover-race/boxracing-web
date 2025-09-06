# Chrome Bridge

A tool to monitor console output from Chrome's debugging interface for the boxracing-web application.

## Usage

```bash
# Navigate to http://localhost:8080/ and listen for 6 seconds
./read-console.sh

# Listen for 10 seconds
./read-console.sh --time 10

# Listen for 30 seconds
./read-console.sh --time 30

# Reload current page and listen for 6 seconds (default)
node check-console.js

# Reload current page and listen for 5 seconds
node check-console.js --time 5

# Navigate to specific URL and listen for 15 seconds
node check-console.js --navigate http://example.com --time 15

# Just restart/reload the page (no console capture)
node check-console.js --restart

# Show help
node check-console.js --help
```
