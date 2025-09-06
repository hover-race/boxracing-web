const CDP = require('chrome-remote-interface');
const http = require('http');

async function reloadAndGetConsole() {
    let client;
    try {
        console.log('Connecting to Chrome debugging interface on localhost:9222...');
        
        // First, get list of available tabs
        const allTabs = await CDP.List();
        console.log(`\nFound ${allTabs.length} available tabs:`);
        allTabs.forEach((tab, index) => {
            console.log(`  ${index + 1}. ${tab.title} - ${tab.url}`);
        });
        
        // Filter out DevTools tabs and find the first regular tab
        const regularTabs = allTabs.filter(tab => !tab.url.startsWith('devtools://'));
        console.log(`\nFound ${regularTabs.length} regular tabs (excluding DevTools):`);
        regularTabs.forEach((tab, index) => {
            console.log(`  ${index + 1}. ${tab.title} - ${tab.url}`);
        });
        
        const targetTab = regularTabs[0];
        if (!targetTab) {
            throw new Error('No regular tabs found (all tabs are DevTools)');
        }
        
        console.log(`\nConnecting to first regular tab: ${targetTab.title}`);
        client = await CDP({target: targetTab});
        
        // Extract domains we need
        const {Runtime, Console, Page} = client;
        
        // Enable domains
        await Runtime.enable();
        await Console.enable();
        await Page.enable();
        
        console.log('Connected successfully!');
        
        // Check current page URL
        const currentUrl = await Page.getFrameTree();
        console.log('Current page URL:', currentUrl.frameTree.frame.url);
        
        // Set up console message listeners BEFORE reload
        const messages = [];
        
        Console.messageAdded((params) => {
            const message = params.message;
            const timestamp = new Date().toISOString();
            const level = message.level || 'log';
            const text = message.text || '';
            const url = message.url || 'unknown';
            const line = message.line || 0;
            const column = message.column || 0;
            
            messages.push({
                timestamp,
                level,
                text,
                url,
                line,
                column
            });
        });
        
        
        // Also listen for console errors that might contain detailed exception info
        Runtime.consoleAPICalled((params) => {
            if (params.type === 'error' && params.args && params.args.length > 0) {
                const timestamp = new Date().toISOString();
                const errorText = params.args.map(arg => {
                    if (arg.type === 'string') return arg.value;
                    if (arg.type === 'object' && arg.subtype === 'error') {
                        return `${arg.className}: ${arg.description}`;
                    }
                    return arg.description || arg.value || 'Unknown';
                }).join(' ');
                
                messages.push({
                    timestamp,
                    level: 'CONSOLE_ERROR',
                    text: errorText,
                    url: params.stackTrace && params.stackTrace.callFrames.length > 0 ? 
                         params.stackTrace.callFrames[0].url : 'unknown',
                    line: params.stackTrace && params.stackTrace.callFrames.length > 0 ? 
                          params.stackTrace.callFrames[0].lineNumber : 0,
                    column: params.stackTrace && params.stackTrace.callFrames.length > 0 ? 
                            params.stackTrace.callFrames[0].columnNumber : 0,
                    stackTrace: params.stackTrace
                });
            }
        });
        
        // Listen for promise rejections
        Runtime.exceptionThrown((params) => {
            const exception = params.exceptionDetails;
            const timestamp = new Date().toISOString();
            
            // Use exception.exception.description for full error message with stack trace
            let exceptionText = exception.exception?.description || exception.text || 'Unknown exception';
            
            // Check if this is a promise rejection
            const isPromiseRejection = exceptionText.includes('(in promise)') || 
                                     exception.stackTrace?.callFrames?.some(frame => 
                                         frame.functionName?.includes('await') || 
                                         frame.functionName?.includes('Promise')
                                     );
            
            messages.push({
                timestamp,
                level: isPromiseRejection ? 'PROMISE_REJECTION' : 'EXCEPTION',
                text: exceptionText,
                url: exception.url,
                line: exception.lineNumber,
                column: exception.columnNumber,
                stackTrace: exception.stackTrace,
                exceptionId: exception.exceptionId
            });
        });
        
        // Check if we should navigate to a specific URL
        const navigateIndex = args.indexOf('--navigate');
        if (navigateIndex !== -1 && navigateIndex + 1 < args.length) {
            const targetUrl = args[navigateIndex + 1];
            console.log(`\n=== Navigating to ${targetUrl} ===`);
            await Page.navigate({url: targetUrl});
            
            // Wait for navigation with timeout
            try {
                await Promise.race([
                    Page.loadEventFired(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 10000))
                ]);
                console.log('Page navigated successfully!');
            } catch (error) {
                console.log('Navigation timeout, continuing anyway...');
            }
        } else {
            console.log('\n=== Reloading Current Page ===');
            await Page.reload();
            
            // Wait for reload with timeout
            try {
                await Promise.race([
                    Page.loadEventFired(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Reload timeout')), 10000))
                ]);
                console.log('Page reloaded successfully!');
            } catch (error) {
                console.log('Reload timeout, continuing anyway...');
            }
        }
        
        // Wait for page to load and capture messages
        console.log('Capturing console output...');
        
        // Check for custom wait time
        const timeIndex = args.indexOf('--time') || args.indexOf('--seconds');
        let waitTime = 1000; // default 1 second
        
        if (timeIndex !== -1 && timeIndex + 1 < args.length) {
            const customTime = parseInt(args[timeIndex + 1]);
            if (!isNaN(customTime) && customTime > 0) {
                waitTime = customTime * 1000; // convert to milliseconds
                console.log(`Listening for ${customTime} seconds...`);
            }
        } else {
            console.log('Listening for 1 second...');
        }
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Check if we should show only errors
        const errorsOnly = !args.includes('--all') && !args.includes('--verbose');
        
        // Filter messages to show only errors if requested
        const filteredMessages = errorsOnly ? 
            messages.filter(msg => 
                msg.level === 'ERROR' || 
                msg.level === 'EXCEPTION' || 
                msg.level === 'PROMISE_REJECTION' ||
                msg.level === 'CONSOLE_ERROR'
            ) : messages;
        
        // Display captured messages
        if (filteredMessages.length === 0) {
            console.log('No errors found.');
        } else {
            filteredMessages.forEach(msg => {
                console.log(msg.text);
                if (msg.url !== 'unknown') {
                    console.log(`  at ${msg.url}:${msg.line}:${msg.column}`);
                }
                if (msg.stackTrace) {
                    msg.stackTrace.callFrames.forEach((frame, index) => {
                        console.log(`    ${index + 1}. ${frame.functionName || 'anonymous'} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`);
                    });
                }
                console.log('');
            });
        }
        
        console.log('\n=== Done ===');
        
    } finally {
        if (client) {
            await client.close();
        }
        // Force exit to prevent hanging
        process.exit(0);
    }
}

async function restartPage() {
    let client;
    try {
        console.log('Connecting to Chrome debugging interface...');
        
        // Get list of available tabs and connect to first regular tab
        const allTabs = await CDP.List();
        const regularTabs = allTabs.filter(tab => !tab.url.startsWith('devtools://'));
        const targetTab = regularTabs[0];
        if (!targetTab) {
            throw new Error('No regular tabs found (all tabs are DevTools)');
        }
        
        console.log(`Connecting to first regular tab: ${targetTab.title}`);
        client = await CDP({target: targetTab});
        const {Page} = client;
        await Page.enable();
        
        console.log('Restarting page...');
        await Page.reload();
        console.log('Page restarted successfully!');
        
    } finally {
        if (client) {
            await client.close();
        }
        // Force exit to prevent hanging
        process.exit(0);
    }
}

// Check command line arguments
const args = process.argv.slice(2);

// Show help if requested
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Chrome Remote Debugger Console Reader

Usage:
  node check-console.js [options]

Options:
  --navigate <url>     Navigate to specific URL instead of reloading current page
  --time <seconds>     Listen for specified number of seconds (default: 1)
  --seconds <seconds>  Alias for --time
  --all               Show all console messages (default: errors only)
  --verbose           Show all console messages with timestamps
  --restart           Just restart/reload the current page (no console capture)
  --help, -h          Show this help message

Examples:
  node check-console.js                           # Reload current page, show errors only
  node check-console.js --time 10                 # Listen for 10 seconds, show errors only
  node check-console.js --all                     # Show all console messages
  node check-console.js --verbose                 # Show all messages with timestamps
  node check-console.js --restart                 # Just reload the page
`);
    process.exit(0);
}

if (args.includes('--restart')) {
    restartPage();
} else {
    reloadAndGetConsole();
}
