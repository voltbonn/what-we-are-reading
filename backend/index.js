require('dotenv').config()

const isDevEnvironment = process.env.environment === 'dev' || false
const path = require('path')
const url = require('url')

const http = require('http')

const express = require('express')
const rateLimit = require('express-rate-limit')

const session = require('express-session')
const FileStore = require('session-file-store')(session)
const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy

const sqlite3 = require('@louislam/sqlite3').verbose();

const { v4: uuidv4 } = require('uuid');

const session_cookie_name = '__share_session'

const default_roles = {
  external_user: false,
  internal_user: false,
  invited: false,
  blocked: false,
  moderator: false,
}

// const { fetch } = require('cross-fetch')

// const fs = require('fs')

const static_files_path = path.join(__dirname,
  isDevEnvironment
    ? '../frontend/' // '../frontend/build/'
    : '../frontend/'
)

function checkOrigin(origin) {
  return (
    typeof origin === 'string'
    && (
      origin === 'volt.link'
      || origin.endsWith('://volt.link')

      // allow from subdomains
      || origin.endsWith('.volt.link')

      // allow for localhost
      // || origin.endsWith('localhost:3000')
      // || origin.endsWith('localhost:4000')
      // || origin.endsWith('0.0.0.0:3000')
      // || origin.endsWith('0.0.0.0:4000')
      // || origin.endsWith('localhost:19006')
    )
  )
}


const db_path = path.join(__dirname, '../../shared_links_db.sqlite3')
const db = new sqlite3.Database(db_path)
db.serialize(() => {
  // date is always the date-created if not specified otherwise

  // db.run('CREATE TABLE IF NOT EXISTS users (uuid TEXT PRIMARY KEY, email TEXT, date TEXT)')
  db.run('CREATE TABLE IF NOT EXISTS invites (uuid TEXT PRIMARY KEY, email TEXT, used_by_email TEXT, date_issued TEXT, date_used TEXT)')
  db.run('CREATE TABLE IF NOT EXISTS posts (uuid TEXT PRIMARY KEY, text TEXT, email TEXT, date TEXT)')
  db.run('CREATE TABLE IF NOT EXISTS statistics (uuid TEXT PRIMARY KEY, user_email TEXT, taken_action TEXT, about_post_uuid TEXT, about_content TEXT, date TEXT)')
})



function getStatisticsForPost({
  about_post_uuid = null,
}) {
  return new Promise(resolve => {
    db.serialize(() => {
      const sql = 'SELECT about_content, COUNT(about_content) AS count FROM statistics WHERE about_post_uuid = ? GROUP BY about_content'
      db.all(sql, [about_post_uuid], (error, rows) => {
        if (error) {
          console.error(error)
          resolve([])
        } else {
          resolve(rows)
        }
      })
    })
  })
}

function getLastestPosts({
  amount = 10,
  hashtag = null,
  user_email = null,
  roles = default_roles,
}) {
  return new Promise(resolve => {
    // get data from sqlite database
    db.serialize(() => {
      let sql = `SELECT uuid, text, email, date AS date FROM posts ORDER BY date DESC LIMIT ${amount}`

      if (hashtag) {
        sql = `SELECT uuid, text, email, date AS date FROM posts WHERE text LIKE "%#${hashtag}%" ORDER BY date DESC LIMIT ${amount}`
      }
      db.all(sql, async (error, rows) => {
        if (error) {
          console.error(error)
          resolve([])
        } else {

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i]

            row.statistics = await getStatisticsForPost({
              about_post_uuid: row.uuid,
            })

            row.permissions = {
              can_delete: false,
            }

            if (user_email !== null) {
              if (
                roles.moderator === true
                || (
                  user_email === row.email
                  && roles.internal_user === true
                  && roles.invited === true
                  && roles.blocked === false
                )
              ) {
                row.permissions.can_delete = true
              }
            }

            delete row.email; // make the posts annonymous

            rows[i] = row
          }
          resolve(rows)
        }
      })
    })
  })
}

function getInvitesForUser({ email }) {
  return new Promise((resolve, reject) => {
    db.all('SELECT uuid, date_issued, date_used FROM invites WHERE email = ?', [email], (err, rows) => {
      if (err) {
        reject(err)
      } else {
        resolve(rows)
      }
    })
  })
}

function generateNewInvites({ email, count = 5 }) {
  // add 5 new invites to the database in one go
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      const stmt = db.prepare('INSERT INTO invites (uuid, email, used_by_email, date_issued, date_used) VALUES (?, ?, ?, ?, ?)')

      for (let i = 0; i < count; i++) {
        stmt.run([
          uuidv4(), email, '', new Date().toISOString(), ''
        ])
      }

      stmt.finalize()

      resolve()
    })
  })
}

function didUserUseInvite({ email }) {
  return new Promise((resolve, reject) => {
    db.all('SELECT uuid, date_issued, date_used FROM invites WHERE used_by_email = ?', [email], (err, rows) => {
      if (err) {
        reject(err)
      } else {
        resolve(rows)
      }
    })
  })
}

function getAllInviteCount() {
  // get the count of all invites
  return new Promise((resolve, reject) => {
    db.all('SELECT COUNT(*) as count FROM invites', [], (err, rows) => {
      if (err) {
        reject(err)
      } else {
        if (rows.length > 0) {
          resolve(rows[0].count)
        } else {
          resolve(0)
        }
      }
    })
  })
}


const app = express()

// const isAbsoluteUrlRegexp = new RegExp('^(?:[a-z]+:)?//', 'i')

// // set up rate limiter: maximum of 1000 requests per minute
// app.use(new RateLimit({
//   windowMs: 1 * 60 * 1000, // 1 minute
//   max: 1000, // requests per minute
// })) // apply rate limiter to all requests

// set up rate limiter:
app.use(rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per `window` (here, per 1 minute)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})) // apply rate limiter to all requests

app.use(express.json())

app.use(function (req, res, next) {
  // const origin = req.get('origin')
  const origin = req.header('Origin')
  if (checkOrigin(origin)) {
    req.is_subdomain = true
    req.origin = origin
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', true)
  } else {
    req.is_subdomain = false
  }

  next()
})

app.options("/*", function (req, res, next) {
  // correctly response for cors
  if (req.is_subdomain) {
    res.setHeader('Access-Control-Allow-Origin', req.origin)
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With')
    res.sendStatus(200)
  } else {
    res.sendStatus(403)
  }
})

// START AUTH
async function session_middleware(req, res, next) {

  if (!!req.headers['-x-session']) {
    req.headers.cookie = session_cookie_name + '=' + req.headers['-x-session']
  }

  const sessionTTL = 60 * 60 * 24 * 14 // = 14 days

  session({
    name: session_cookie_name,
    secret: process.env.express_session_secret,
    cookie: {
      httpOnly: false,
      // domain: false, // for localhost
      domain: (isDevEnvironment ? 'localhost' : 'hope.volt.link'),
      sameSite: 'lax',
      secure: false, // somehow doesnt work when its true
      maxAge: 1000 * sessionTTL,
    },
    store: new FileStore({
      path: './sessions/',
      retries: 2,
    }),
    saveUninitialized: false, // don't create session until something stored
    resave: true, // don't save session if unmodified
    unset: 'destroy',
  })(req, res, next)
}

app.use(session_middleware)

passport.serializeUser(function (user, done) {
  done(null, user)
})
passport.deserializeUser(function (id, done) {
  done(null, id)
})

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: (isDevEnvironment ? 'http://localhost:4008/auth/google/callback' : 'https://hope.volt.link/auth/google/callback'),
},
  function (accessToken, refreshToken, profile = {}, done) {
    if (
      !!accessToken
      && profile.hasOwnProperty('emails')
      && profile.emails.length > 0
      && profile.emails[0].verified === true
      && profile.emails[0].value.endsWith('@volteuropa.org')
      // && profile._json.hd === '@volteuropa.org'
      // && profile.provider === 'google'
    ) {
      done(null, {
        status: 'internal',
        id: profile.id,
        displayName: profile.displayName,
        name: profile.name || {},
        email: profile.emails[0].value,
        picture: (profile.photos && profile.photos.length > 0 && profile.photos[0].value ? profile.photos[0].value : ''),
      })
    } else {
      done(null, {
        status: 'external'
      })
      // done(new Error('Wrong Email Domain. You need to be part of Volt Europa.'), null)
    }
  }
))

app.use(passport.initialize())
app.use(passport.session())

app.use(async function (req, res, next) {

  req.roles = { ...default_roles } // clone default roles

  if (!!req.user && !!req.user.id && req.user.id !== null && req.user.email.length > 0) {
    req.roles.internal_user = true
  } else {
    req.roles.external_user = true
  }

  if (req.roles.internal_user === true) {

    const allInviteCount = await getAllInviteCount()
    if (allInviteCount === 0) {
      // if no invites exist, generate new ones for the current user.
      // this ensures that users can always be invited
      // this is probably only needed for the first user
      await generateNewInvites({ email: req.user.email })
      const invitesForUser = await getInvitesForUser({ email: req.user.email })
      if (invitesForUser.length > 0) {
        await useInvite({
          uuid: invitesForUser[0].uuid,
          email: req.user.email,
        })
      }
    } else {
      // check if user used an invite
      // and is therefore allowed to invite others
      // and is allowed to use the website at all
      const invites = await didUserUseInvite({ email: req.user.email })
      if (invites.length > 0) {
        req.roles.invited = true

        // check invites were already generated for the user
        const invitesForUser = await getInvitesForUser({ email: req.user.email })
        if (invitesForUser.length === 0) {
          // if not, generate new ones
          await generateNewInvites({ email: req.user.email })
        }
      }
    }


    const blocked_emails = (process.env.blocked_emails || '').split(',')
    if (blocked_emails.includes(req.user.email)) {
      req.roles.blocked = true
    }

    const moderator_emails = (process.env.moderator_emails || '').split(',')
    if (moderator_emails.includes(req.user.email)) {
      req.roles.moderator = true
    }
  }
  

  // const origin = req.get('origin')
  const origin = req.header('Origin')
  if (checkOrigin(origin)) {
    req.is_subdomain = true
    req.origin = origin
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', true)
  } else {
    req.is_subdomain = false
  }

  next()
})

app.get('/auth/google', function (req, res) {
  passport.authenticate('google', {
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state: JSON.stringify({
      redirect_to: req.query.redirect_to || ''
    }),
  })(req, res)
})

app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureFlash: false, failureRedirect: '/auth/failure' }),
  function (req, res) {
    let redirect_to = null
    if (req.query.state) {
      const state = JSON.parse(req.query.state)
      redirect_to = state.redirect_to
    }
    res.redirect(typeof redirect_to === 'string' && redirect_to.length > 0 ? redirect_to : '/')
  }
)
app.get('/auth/failure', function (req, res) {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Login Error</title>
<style>
body {
  font-family: Ubuntu, sans-serif;
  color: #502379;
  padding: 32px;
}
a,
a:visited {
  color: #502379;
}
a:hover {
  opacity: 0.7;
}
</style>
</head>
<body>
  <h1>Login Error</h1>
  <p>You need to use a Volt Europa account to log in.</p>
  <!--sse-->Contact: <a href="mailto:thomas.rosen@volteuropa.org">thomas.rosen@volteuropa.org</a></br><!--/sse-->
</body>
</html>
`)
})

app.get('/logout', function (req, res) {
  req.session.cookie.maxAge = 0 // set the maxAge to zero, to delete the cookie
  req.logout(() => {
    res.clearCookie(session_cookie_name)
    req.session.save(error => { // save the above setting
      if (error) {
        console.error(error)
        res.send(error)
      } else {
        const redirect_to = req.query.redirect_to
        res.redirect(typeof redirect_to === 'string' && redirect_to.length > 0 ? redirect_to : '/') // send the updated cookie to the user and go to the initally page
      }
    })
  })
})
// END AUTH

app.get('/login', (req, res) => {
  res.redirect(url.format({
    pathname: '/auth/google',
    query: req.query,
  }))
})

app.get('/api/whoami', (req, res) => {
  if (req.roles.internal_user === true && !!req.user) {
    res.json({
      ...req.user,
      roles: req.roles,
    })
  } else {
    res.json({
      status: 'external',
      roles: req.roles,
    })
  }
})

app.get('/api/latest', async (req, res) => {
  if (
    req.roles.internal_user === true
    && req.roles.invited === true
    && !!req.user
  ) {
    res.json({
      posts: await getLastestPosts({
        amount: 100,
        user_email: req.user.email,
      })
    })
  } else {
    res.json({
      posts: []
    })
  }
})
app.get('/api/latest_with_hashtag/:hashtag', async (req, res) => {
  const hashtag = req.params.hashtag || ''
  if (
    hashtag.length > 0
    && req.roles.internal_user === true
    && req.roles.invited === true
    && !!req.user
  ) {
    res.json({
      posts: await getLastestPosts({
        amount: 100,
        user_email: req.user.email,
        hashtag,
      })
    })
  } else {
    res.json({
      posts: []
    })
  }
})

app.post('/api/share', (req, res) => {
  if (
    req.roles.internal_user === true
    && req.roles.invited === true
    && req.roles.blocked === false
    && !!req.user
  ) {
    // get data from req.body

    const text = req.body.text || ''

    if (text.length === 0) {
      res.json({
        shared: false,
        error: 'Plase enter a text.'
      })
    } else {

      const data = {
        uuid: uuidv4(), // todo check if uuid already exists
        text: req.body.text,
        email: req.user.email,
        date: new Date().toISOString(),
      }

      // save to a sqlite database
      try {
        db.serialize(() => {
          db.run('CREATE TABLE IF NOT EXISTS posts (uuid TEXT PRIMARY KEY, text TEXT, email TEXT, date TEXT)')
          db.run('INSERT INTO posts (uuid, text, email, date) VALUES (?, ?, ?, ?)', [
            data.uuid, data.text, data.email, data.date
          ], function (error) {
            if (error) {
              throw error
            } else {
              res.json({
                shared: true,
              })
            }
          })
        })
      } catch (error) {
        console.error(error)
        res.json({
          shared: false,
          error: String(error),
        })
      }
    }
  } else {
    res.json({
      shared: false
    })
  }
})

app.delete('/api/delete/:uuid', (req, res) => {
  const uuid = req.params.uuid || ''
  if (
    uuid.length > 0
    && req.roles.internal_user === true
    && req.roles.invited === true
    && req.roles.blocked === false
    && !!req.user
  ) {
    // delete post with the uuid
    const email = req.user.email
    try {
      db.serialize(() => {
        db.run('DELETE FROM posts WHERE uuid = ? AND email = ?', [uuid, email], function (error) {
          if (error) {
            throw error
          } else {
            res.json({
              deleted: true,
            })
          }
        })
      })
    } catch (error) {
      console.error(error)
      res.json({
        deleted: false,
        error: String(error),
      })
    }
  } else {
    res.json({
      deleted: false
    })
  }
})

app.post('/api/statistics', (req, res) => {

  if (req.roles.internal_user === false) {
    res.json({
      saved: false,
      error: 'Not logged in.',
    })
    return
  }

  const data = {
    taken_action: req.body.taken_action || '',
    about_post_uuid: req.body.about_post_uuid || '',
    about_content: req.body.about_content || '',

    uuid: uuidv4(), // todo check if uuid already exists
    user_email: req.user.email || '',
    date: new Date().toISOString(),
  }

  if (data.about_post_uuid.length === 0) {
    res.json({
      saved: false,
      error: 'No post uuid.',
    })
  }

  if (data.taken_action.length === 0) {
    res.json({
      saved: false,
      error: 'No action.',
    })
  }

  if (data.about_post_uuid.length > 0) {
    // save to a sqlite database
    try {
      db.serialize(() => {
        db.run('CREATE TABLE IF NOT EXISTS statistics (uuid TEXT PRIMARY KEY, user_email TEXT, taken_action TEXT, about_post_uuid TEXT, about_content TEXT, date TEXT)')
        // uuid
        // user_email = email_of_user
        // taken_action = action_that_happend "clicked"
        // post_uuid = uuid_of_post / where
        // content = what_was_clicked
        // date
        db.run('INSERT INTO statistics (uuid, user_email, taken_action, about_post_uuid, about_content, date) VALUES (?, ?, ?, ?, ?, ?)', [
          data.uuid, data.user_email, data.taken_action, data.about_post_uuid, data.about_content, data.date
        ], function (error) {
          if (error) {
            throw error
          } else {
            res.json({
              saved: true,
            })
          }
        })
      })
    } catch (error) {
      console.error(error)
      res.json({
        saved: false,
        error: String(error),
      })
    }
  } else {
    res.json({
      saved: false
    })
  }
})

app.get('/api/invites', async (req, res) => {
  try {

    if (req.roles.internal_user === false) {
      throw new Error('Not logged in.')
    }

    if (!(!!req.user && !!req.user.email)) {
      throw new Error('No email.')
    }

    if (req.roles.invited === false) {
      throw new Error('Not invited.')
    }
  
    const invites = await getInvitesForUser({ email: req.user.email })
    res.json({
      invites,
    })
  } catch (error) {
    res.json({
      invites: [],
      error: String(error),
    })
  }
  
})

function useInvite({ uuid, email }) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // check if invite was already used
      db.get('SELECT used_by_email FROM invites WHERE uuid = ?', [uuid], function (error, row) {
        if (error) {
          reject(error)
        } else {
          if (
            row
            && typeof row.used_by_email === 'string'
            && row.used_by_email.length > 0
          ) {
            reject('Invite already used.')
          } else {
            // update invite to used
            db.run('UPDATE invites SET date_used = ?, used_by_email = ? WHERE uuid = ?', [new Date().toISOString(), email, uuid], function (error) { // todo this update thing does not work
              if (error) {
                reject(error)
              } else {
                resolve(true)
              }
            })
          }
        }
      })
    })
  })
}


app.get('/api/use_invite/:uuid', async (req, res) => {

  try {

    const uuid = req.params.uuid || ''
    const email = req.user.email || ''

    if (uuid.length === 0) {
      throw new Error('No uuid. (/api/use_invite/:uuid) ')
    }

    if (req.roles.internal_user === false) {
      throw new Error('Not logged in.')
    }

    if (req.roles.invited === true) {
      throw new Error('Already invited.')
    }

    if (!req.user || !req.user.email) {
      throw new Error('No email.')
    }

    res.json({
      invite: await useInvite({ uuid, email })
    })

  } catch (error) {
    res.json({
      invited: false,
      error: String(error),
    })
  }
})


app.get('/invite/:uuid', async (req, res) => {

  try {
    const uuid = req.params.uuid || ''

    if (uuid.length === 0) {
      // redirect to /
      res.redirect('/')
    }

    if (req.roles.internal_user === true) {

      if (req.roles.invited === true) {
        res.redirect('/')
        return
      }

      if (!!req.user && !!req.user.email) {
        await useInvite({ uuid, email: req.user.email })
      }
    }
  } catch (error) {
    console.error(error)
  }

  // display index.html from static_files_path
  res.sendFile('index.html', { root: static_files_path })
})

app.use(express.static(static_files_path))

const port = 4008
const host = '0.0.0.0' // Uberspace wants 0.0.0.0
http.createServer(app).listen({ port, host }, () => {
  console.info(`
    🚀 Server ready
    For uberspace: http://${host}:${port}/
    For local development: http://localhost:${port}/
  `)
})

