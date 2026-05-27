const https = require('https');

const API_KEY = "AIzaSyC-9KFTgkwhobbxmRrQOqih5Y8Admd9cA4";

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch(e) { reject(e); }
            });
        }).on('error', reject);
    });
}

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { action, query, placeId, pagetoken } = JSON.parse(event.body);

        let result;

        if (action === 'search') {
            let url;
            if (pagetoken) {
                url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(pagetoken)}&key=${API_KEY}`;
            } else {
                url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
            }
            result = await httpsGet(url);

        } else if (action === 'details') {
            const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website,url&key=${API_KEY}`;
            result = await httpsGet(url);

        } else if (action === 'scrapeEmail') {
            // Fetch a website page and extract emails from it
            const { website } = JSON.parse(event.body);
            result = await scrapeEmailFromWebsite(website);
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ success: true, email: result })
            };
        } else {
            return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ success: true, data: result })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ success: false, error: err.message || err.toString() })
        };
    }
};

async function scrapeEmailFromWebsite(website) {
    if (!website) return "";
    const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

    async function fetchPage(url) {
        return new Promise((resolve) => {
            try {
                const mod = url.startsWith('https') ? require('https') : require('http');
                const req = mod.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                    // Follow redirects
                    if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                        fetchPage(res.headers.location).then(resolve);
                        return;
                    }
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data));
                });
                req.on('error', () => resolve(''));
                req.on('timeout', () => { req.destroy(); resolve(''); });
            } catch(e) { resolve(''); }
        });
    }

    const clean = t => t.replace(/\[at\]/g,'@').replace(/\(at\)/g,'@').replace(/\[dot\]/g,'.').replace(/\(dot\)/g,'.');

    // Try homepage
    let text = clean(await fetchPage(website));
    let matches = text.match(emailRegex);
    if (matches && matches.length) return matches[0];

    // Try contact pages
    for (const path of ['contact', 'contact-us', 'about']) {
        const subUrl = website.replace(/\/$/, '') + '/' + path;
        text = clean(await fetchPage(subUrl));
        matches = text.match(emailRegex);
        if (matches && matches.length) return matches[0];
    }
    return "";
}
