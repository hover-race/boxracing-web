# Chrome Bridge

A tool to monitor console output from Chrome's debugging interface for the boxracing-web application.

## Usage

1. Start boxracing web server: `run.sh`
2. Start Chrome with debugging enabled: `./start-chrome-debugger.sh` from the project root. 
3. Run `node check-console.js` to connect to Chrome's debugging interface on port 9222. The script will capture console messages, automatically reload the page, and display any logs or errors from the replay system.

This is useful for debugging the replay functionality - you can see console output when testing the Record and Play buttons, including any errors that occur during recording and playback.
