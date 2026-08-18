const nodemailer = require('nodemailer')

const { parseBody } = require('../lib/parse-body')

/**
 * Send a single HTML email through the provided SMTP credentials.
 * @param {import('http').IncomingMessage & { method?: string, body?: unknown }} req
 * @param {import('http').ServerResponse & { status: Function, json: Function, send: Function }} res
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed')
  }

  try {
    const data = parseBody(req)

    const transporter = nodemailer.createTransport({
      host: data.host,
      port: 465,
      secure: true,
      auth: {
        user: data.user,
        pass: data.password
      }
    })

    const mailOptions = {
      from: `"${data.fromName || data.user}" <${data.user}>`,
      to: data.to,
      subject: data.subject,
      html: data.body
    }

    await transporter.sendMail(mailOptions)

    return res.status(200).json({ success: true, message: 'OK' })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error })
  }
}
