const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;

exports.handler = async function(event, context) {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const data = JSON.parse(event.body);
        const config = {
            imap: {
                user: data.user,
                password: data.password,
                host: data.host,
                port: data.port || 993,
                tls: true,
                tlsOptions: { rejectUnauthorized: false },
                authTimeout: 10000
            }
        };

        // 1. Connect to IMAP
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        // 2. Search for standard bounce notifications
        const searchCriteria = [
            ['OR', ['SUBJECT', 'Delivery Status Notification'], ['FROM', 'Mailer-Daemon']]
        ];
        // Fetch only the full body
        const fetchOptions = { bodies: [''], struct: true };

        const messages = await connection.search(searchCriteria, fetchOptions);
        
        const failedEmails = new Set();
        // Regex matching standard email addresses
        const pattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

        // 3. Parse each fetched email to extract bounced addresses
        for (const item of messages) {
            const all = item.parts.find(part => part.which === '');
            const id = item.attributes.uid;
            const idHeader = "Imap-Id: "+id+"\r\n";
            // simpleParser parses raw RFC822 format
            const mail = await simpleParser(idHeader + all.body);

            let text = mail.text || mail.html || '';
            const matches = text.match(pattern) || [];

            for (const addr of matches) {
                const lowerAddr = addr.toLowerCase().trim();
                // Avoid logging our own email
                if (lowerAddr !== data.user.toLowerCase()) {
                    // Filter out mail servers and system addresses
                    if (!['a2hosted', 'starka', 'mailer-daemon', 'postmaster', 'google.com', 'mx.'].some(x => lowerAddr.includes(x))) {
                        failedEmails.add(lowerAddr);
                    }
                }
            }
        }

        connection.end();

        // 4. Return unique failed emails to the frontend
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                success: true,
                failed_emails: Array.from(failedEmails)
            })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ success: false, error: err.message || err.toString() })
        };
    }
};
