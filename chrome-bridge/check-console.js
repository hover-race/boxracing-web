const CDP = require('chrome-remote-interface');
const http = require('http');

async function getCurrentConsole() {
    let client;
    try {
        console.log('Connecting to Chrome debugging interface on localhost:9222...');
        
        // Connect to Chrome debugging interface
        client = await CDP();
        
        // Extract domains we need
        const {Runtime, Console, Page} = client;
        
        // Enable domains
        await Runtime.enable();
        await Console.enable();
        await Page.enable();
        
        console.log('Connected successfully!');
        
        // Get current console messages
        console.log('\n=== Current Console Messages ===');
        
        // Listen for console messages (this will capture any new ones)
        Console.messageAdded((params) => {
            const message = params.message;
            const timestamp = new Date().toISOString();
            const level = message.level || 'log';
            const text = message.text || '';
            const url = message.url || 'unknown';
            const line = message.line || 0;
            const column = message.column || 0;
            
            console.log(`[${timestamp}] ${level.toUpperCase()}: ${text}`);
            if (url !== 'unknown') {
                console.log(`  at ${url}:${line}:${column}`);
            }
            console.log('');
        });
        
        // Listen for runtime exceptions
        Runtime.exceptionThrown((params) => {
            const exception = params.exceptionDetails;
            const timestamp = new Date().toISOString();
            
            console.log(`[${timestamp}] EXCEPTION: ${exception.text}`);
            console.log(`  at ${exception.url}:${exception.lineNumber}:${exception.columnNumber}`);
            if (exception.stackTrace) {
                console.log('  Stack trace:');
                exception.stackTrace.callFrames.forEach((frame, index) => {
                    console.log(`    ${index + 1}. ${frame.functionName || 'anonymous'} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`);
                });
            }
            console.log('');
        });
        
        // Wait a moment to capture any immediate messages
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('\n=== Restarting Page ===');
        await Page.reload();
        console.log('Page reloaded successfully!');
        
        // Wait a bit more to see post-reload messages
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('\n=== Done ===');
        
    } catch (err) {
        console.error('Error:', err.message);
        console.log('\nMake sure Chrome is running with debugging enabled:');
        console.log('./start-chrome-debugger.sh');
    } finally {
        if (client) {
            await client.close();
        }
    }
}

// Run the script
getCurrentConsole();
