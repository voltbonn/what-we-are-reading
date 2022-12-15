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

const sqlite3 = require('sqlite3').verbose();

const { v4: uuidv4 } = require('uuid');

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
  db.run('CREATE TABLE IF NOT EXISTS posts (uuid TEXT PRIMARY KEY, text TEXT, email TEXT, date TEXT)')
})


const app = express()

// const isAbsoluteUrlRegexp = new RegExp('^(?:[a-z]+:)?//', 'i')

// // set up rate limiter: maximum of 1000 requests per minute
// app.use(new RateLimit({
//   windowMs: 1 * 60 * 1000, // 1 minute
//   max: 1000, // requests per minute
// })) // apply rate limiter to all requests

// set up rate limiter: maximum of 100 requests per minute
app.use(rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // Limit each IP to 1000 requests per `window` (here, per 1 minute)
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
    req.headers.cookie = '__session=' + req.headers['-x-session']
  }

  const sessionTTL = 60 * 60 * 24 * 14 // = 14 days

  session({
    name: '__session',
    secret: process.env.express_session_secret,
    cookie: {
      httpOnly: false,
      // domain: false, // for localhost
      domain: (isDevEnvironment ? 'localhost' : 'share.volt.link'),
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
  callbackURL: (isDevEnvironment ? 'http://localhost:4004/auth/google/callback' : 'https://api.volt.link/auth/google/callback'),
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

app.use(function (req, res, next) {
  if (!!req.user && !!req.user.id && req.user.id !== null) {
    req.logged_in = true
  } else {
    req.logged_in = false
  }

  const blocked_emails = (process.env.blocked_emails || '').split(',')
  if (req.logged_in && blocked_emails.includes(req.user.email)) {
    req.blocked = true
  } else {
    req.blocked = false
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
    res.clearCookie('__session')
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
  if (req.logged_in === true && !!req.user) {
    res.json({
      ...req.user,
      blocked: req.blocked,
    })
  } else {
    res.json({
      status: 'external'
    })
  }
})

function getLastestPosts({
  amount = 10,
  hashtag = null,
}) {
  return new Promise(resolve => {
    // get data from sqlite database
    db.serialize(() => {
      let sql = `SELECT uuid, text, date AS date FROM posts ORDER BY date DESC LIMIT ${amount}`
      if (hashtag) {
        sql = `SELECT uuid, text, date AS date FROM posts WHERE text LIKE "%#${hashtag}%" ORDER BY date DESC LIMIT ${amount}`
      }
      db.all(sql, (error, rows) => {  
        if (error) {
          console.error(error)
          resolve([])
        } else {
          rows = rows.map(row => {
            delete row.email;
            return row
          })
          resolve(rows)
        }
      })
    })
  })
}

app.get('/api/latest', async (req, res) => {
  if (req.logged_in === true && !!req.user) {
    res.json({
      posts: await getLastestPosts({
        amount: 10,
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
  if (hashtag.length > 0 && req.logged_in === true && !!req.user) {
    res.json({
      posts: await getLastestPosts({
        amount: 10,
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
  if (req.logged_in === true && req.blocked === false && !!req.user) {
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

