# Chrome Bridge

A tool to monitor console output from Chrome's debugging interface for the boxracing-web application.

## Usage

```bash
# Reload current page, show errors only (default)
./read-console.sh

# Listen for 10 seconds, show errors only
./read-console.sh --time 10

# Show all console messages
./read-console.sh --all

# Show all messages with timestamps
./read-console.sh --verbose

# Just restart/reload the page (no console capture)
./read-console.sh --restart

# Show help
./read-console.sh --help
```
