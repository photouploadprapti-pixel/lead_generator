const nodemailer = require('nodemailer');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const data = JSON.parse(event.body);

        const transporter = nodemailer.createTransport({
            host: data.host,
            port: 465, // Standard secure SMTP port
            secure: true,
            auth: {
                user: data.user,
                pass: data.password
            }
        });

        const mailOptions = {
            from: `"${data.fromName || data.user}" <${data.user}>`,
            to: data.to,
            subject: data.subject,
            html: data.body
        };

        await transporter.sendMail(mailOptions);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ success: true, message: "OK" })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ success: false, error: err.message || err.toString() })
        };
    }
};
