# Chrome Bridge

A tool to monitor console output from Chrome's debugging interface for the boxracing-web application.

## Usage

**Workflow**: Update game code → Reload page and get console output

1. Start boxracing web server: `run.sh`
2. Start Chrome with debugging enabled: `./start-chrome-debugger.sh` from the project root. 
3. After making code changes, run `node check-console.js` to reload the page and capture console output from the fresh load.
4. Use `node check-console.js --restart` to just restart the page without capturing console.

This is perfect for debugging the replay functionality - make changes to your code, then run the script to see console output from the reloaded page, including any errors from the replay system.
