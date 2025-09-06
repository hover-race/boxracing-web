const CDP = require('chrome-remote-interface');
const http = require('http');

async function reloadAndGetConsole() {
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
        
        // Listen for runtime exceptions
        Runtime.exceptionThrown((params) => {
            const exception = params.exceptionDetails;
            const timestamp = new Date().toISOString();
            
            messages.push({
                timestamp,
                level: 'EXCEPTION',
                text: exception.text,
                url: exception.url,
                line: exception.lineNumber,
                column: exception.columnNumber,
                stackTrace: exception.stackTrace
            });
        });
        
        console.log('\n=== Reloading Page ===');
        await Page.reload();
        console.log('Page reloaded successfully!');
        
        // Wait for page to load and capture messages
        console.log('Capturing console output...');
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        // Display captured messages
        console.log('\n=== Console Output ===');
        if (messages.length === 0) {
            console.log('No console messages captured.');
        } else {
            messages.forEach(msg => {
                console.log(`[${msg.timestamp}] ${msg.level.toUpperCase()}: ${msg.text}`);
                if (msg.url !== 'unknown') {
                    console.log(`  at ${msg.url}:${msg.line}:${msg.column}`);
                }
                if (msg.stackTrace) {
                    console.log('  Stack trace:');
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
    }
}

async function restartPage() {
    let client;
    try {
        console.log('Connecting to Chrome debugging interface...');
        client = await CDP();
        const {Page} = client;
        await Page.enable();
        
        console.log('Restarting page...');
        await Page.reload();
        console.log('Page restarted successfully!');
        
    } finally {
        if (client) {
            await client.close();
        }
    }
}

// Check command line arguments
const args = process.argv.slice(2);
if (args.includes('--restart')) {
    restartPage();
} else {
    reloadAndGetConsole();
}
