const imaps = require('imap-simple')
const { simpleParser } = require('mailparser')

const { parseBody } = require('../lib/parse-body')

/**
 * Scan an IMAP inbox for bounce notifications and return unique failed addresses.
 * @param {import('http').IncomingMessage & { method?: string, body?: unknown }} req
 * @param {import('http').ServerResponse & { status: Function, json: Function, send: Function }} res
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed')
  }

  try {
    const data = parseBody(req)
    const config = {
      imap: {
        user: data.user,
        password: data.password,
        host: data.host,
        port: Number(data.port) || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000
      }
    }

    const connection = await imaps.connect(config)
    await connection.openBox('INBOX')

    const searchCriteria = [
      ['OR', ['SUBJECT', 'Delivery Status Notification'], ['FROM', 'Mailer-Daemon']]
    ]
    const fetchOptions = { bodies: [''], struct: true }

    const messages = await connection.search(searchCriteria, fetchOptions)

    const failedEmails = new Set()
    const pattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    const userEmail = String(data.user || '').toLowerCase()

    for (const item of messages) {
      const all = item.parts.find((part) => part.which === '')
      const id = item.attributes.uid
      const idHeader = 'Imap-Id: ' + id + '\r\n'
      const mail = await simpleParser(idHeader + all.body)

      const text = mail.text || mail.html || ''
      const matches = text.match(pattern) || []

      for (const addr of matches) {
        const lowerAddr = addr.toLowerCase().trim()
        if (lowerAddr !== userEmail) {
          if (!['a2hosted', 'starka', 'mailer-daemon', 'postmaster', 'google.com', 'mx.']
            .some((x) => lowerAddr.includes(x))) {
            failedEmails.add(lowerAddr)
          }
        }
      }
    }

    connection.end()

    return res.status(200).json({
      success: true,
      failed_emails: Array.from(failedEmails)
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error })
  }
}
