
const url_regex = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[\-;:&=\+\$,\w]+@)?[A-Za-z0-9\.\-]+|(?:www\.|[\-;:&=\+\$,\w]+@)[A-Za-z0-9\.\-]+)((?:\/[\+~%\/\.\w\-_]*)?\??(?:[\-\+=&;%@\.\w_]*)#?(?:[\.\!\/\\\w]*))?)/g;
const hashtag_regex = /#(\w+)/g;

function getQueryVariable(variable) {
  const query = window.location.search.substring(1);
  const vars = query.split('&');
  for (let i = 0; i < vars.length; i++) {
    const pair = vars[i].split('=');
    if (decodeURIComponent(pair[0]) == variable) {
      return decodeURIComponent(pair[1]);
    }
  }
}

function getPosts() {

  let url = '/api/latest'

  const hashtag = getQueryVariable('hashtag')
  if (hashtag) {
    url = `/api/latest_with_hashtag/${hashtag}`
  }

  fetch(url)
    .then(response => response.json())
    .then(data => {

      let posts = data.posts

      if (posts.length === 0) {
        document.getElementById('posts_wrapper').classList.add('hidden');
      } else {
        document.getElementById('posts_wrapper').classList.remove('hidden');
      }

      posts = posts 
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map(post => {


          post.click_count = (post.statistics || []).reduce((sum, stats) => sum + stats.count, 0)

          post.text = post.text
            // replace html parts with html-special-chars
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            // make urls clickable
            .replace(url_regex, match => {

              const url = new URL(match)
              if (url.hostname === 'localhost') {
                return url
              }

              // url encode the url
              const url_encoded = encodeURI(url)

              return `<a class="url" href="${url_encoded}" target="_blank">${url}</a>`
            })
            // make hashtags clickable
            .replace(hashtag_regex, (match, p1) => {
              return `<a class="hashtag" href="?hashtag=${encodeURIComponent(p1)}">${match}</a>`
            })

          // get the difference between now and the date in a human readable format
          const date = new Date(post.date)
          const diff = new Date() - date
          if (diff >= 0) {
            const diff_days = Math.floor(diff / (1000 * 60 * 60 * 24))
            const diff_hours = Math.floor(diff / (1000 * 60 * 60))
            const diff_minutes = Math.floor(diff / (1000 * 60))
            const diff_seconds = Math.floor(diff / (1000))

            if (diff_seconds < 60) {
              post.date = `${diff_seconds} ${diff_seconds === 1 ? 'second' : 'seconds'} ago`
            } else if (diff_minutes < 60) {
              post.date = `${diff_minutes} ${diff_minutes === 1 ? 'minute' : 'minutes'} ago`
            } else if (diff_hours < 24) {
              post.date = `${diff_hours} ${diff_hours === 1 ? 'hour' : 'hours'} ago`
            } else if (diff_days < 7) {
              post.date = `${diff_days} ${diff_days === 1 ? 'day' : 'days'} ago`
            } else {
              post.date = new Date(post.date).toLocaleString()
            }
          } else {
            post.date = `${new Date(post.date).toLocaleString()} – IN THE FUTURE`
          }

          return post
        })

      const list_section_element = document.querySelector('#list_section')
      list_section_element.innerHTML = ''

      for (const post of posts) {
        const new_post_ele = document.createElement('div')
        new_post_ele.classList.add('shared_post')

        const text_ele = document.createElement('p')
        text_ele.classList.add('text')
        text_ele.innerHTML = post.text
        text_ele.querySelectorAll('a.url')
          .forEach(url_ele => {
            url_ele.addEventListener('click', event => {

              // get the url from the href attribute
              const url = new URL(decodeURIComponent(url_ele.href))

              saveStatistics({
                taken_action: 'click',
                about_post_uuid: post.uuid,
                about_content: String(url),
              })
              
            })
          })
        text_ele.querySelectorAll('a.hashtag')
          .forEach(hashtag_ele => {
            hashtag_ele.addEventListener('click', event => {

              // get the hashtag from the inner text
              const hashtag = hashtag_ele.innerText

              saveStatistics({
                taken_action: 'click',
                about_post_uuid: post.uuid,
                about_content: hashtag,
              })

            })
          })
        new_post_ele.appendChild(text_ele)

        const footer_ele = document.createElement('div')
        footer_ele.classList.add('footer')
        
        const date_ele = document.createElement('p')
        date_ele.classList.add('body2')
        if (post.click_count > 0) {
          date_ele.innerHTML = `${post.date} – ${post.click_count} ${post.click_count === 1 ? 'click' : 'clicks'}`
        } else {
          date_ele.innerHTML = post.date
        }
        footer_ele.appendChild(date_ele)

        if (post.permissions.can_delete === true) {
          const delete_button_ele = document.createElement('button')
          delete_button_ele.classList.add('red')
          delete_button_ele.innerHTML = 'Delete'
          delete_button_ele.addEventListener('click', () => {
            fetch(`/api/delete/${post.uuid}`, {
              method: 'DELETE'
            })
              .then(response => response.json())
              .then(data => {
                if (data.deleted === true) {
                  new_post_ele.remove()
                } else {
                  console.error(data)
                  alert('Could not delete the post.')
                }
              })
          })
          footer_ele.appendChild(delete_button_ele)
        }

        new_post_ele.appendChild(footer_ele)

        list_section_element.appendChild(new_post_ele)
      }

    })
}

function getInvites() {
  // if logged in, get the invites from /api/invites and list them with uuid, date_issued and date_used
  fetch('/api/invites')
    .then(response => response.json())
    .then(data => {
      console.log('data', data)
      const invites_list_element = document.querySelector('#invites_list')

      const invites = data.invites

      if (invites.length === 0) {
        document.getElementById('invites_wrapper').classList.add('hidden');
        invites_list_element.innerHTML = 'You have no invites.'
      } else {
        document.getElementById('invites_wrapper').classList.remove('hidden');
        invites_list_element.innerHTML = ''

        for (const invite of invites) {
          const new_invite_ele = document.createElement('div')
          new_invite_ele.classList.add('invite')
          new_invite_ele.addEventListener('click', () => {
            // get the current protocol
            const protocol = window.location.protocol
            // get the current domain
            const domain = window.location.hostname
            navigator.clipboard.writeText(`${protocol}//${domain}/invite/${invite.uuid}`) // todo make this work for localhost
              .then(() => {
                alert('Copied to clipboard.')
              })
              .catch(err => {
                console.error('Could not copy to clipboard.', err)
              })
          })

          const uuid_ele = document.createElement('p')
          uuid_ele.classList.add('body2')
          uuid_ele.innerHTML = invite.uuid
          new_invite_ele.appendChild(uuid_ele)

          if (invite.date_used) {
            const date_used_ele = document.createElement('p')
            date_used_ele.classList.add('body2')
            date_used_ele.innerHTML = `Used on: ${new Date(invite.date_used).toLocaleString()}`
            new_invite_ele.appendChild(date_used_ele)
          }

          invites_list_element.appendChild(new_invite_ele)
        }
      }
    })
}

function checkIfLoggedIn() {
  fetch('/api/whoami')
    .then(response => response.json())
    .then(data => {
      console.log('data', data)
      if (data.email) {
        document.getElementById('login_wrapper').classList.add('hidden');
        document.getElementById('logout_wrapper').classList.remove('hidden');
        document.getElementById('user_email').innerHTML = `${data.email}`;
      } else {
        document.getElementById('login_wrapper').classList.remove('hidden');
        document.getElementById('logout_wrapper').classList.add('hidden');
        document.getElementById('user_email').innerHTML = '???@???.???';
      }

      if (data.roles.invited === true && data.roles.blocked === false) {
        document.getElementById('share_wrapper').classList.remove('hidden');
        document.getElementById('blocked_wrapper').classList.add('hidden');
      } else {
        document.getElementById('share_wrapper').classList.add('hidden');
        document.getElementById('blocked_wrapper').classList.remove('hidden');
      }

      if (data.roles.invited === true) {
        document.getElementById('not_invited').classList.add('hidden');
      } else {
        document.getElementById('not_invited').classList.remove('hidden');
      }
    })
}

function saveStatistics({
  taken_action = '',
  about_post_uuid= '',
  about_content = '',
}) {
  fetch('/api/statistics', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      taken_action,
      about_post_uuid,
      about_content,
    })
  })
}

function initShareButtonListener() {
  document.querySelector('#share_submit_button').addEventListener('click', () => {
    const new_share_text = document.querySelector('#new_share_text').value;
    fetch('/api/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: new_share_text
      })
    })
      .then(response => response.json())
      .then(data => {
        console.log(data);
        if (data.shared === true) {
          document.querySelector('#new_share_text').value = '';
          getPosts()
        }
      })
  })
}


function checkForPrefill() {
  const prefill = getQueryVariable('prefill')
  if (prefill) {
    document.querySelector('#new_share_text').innerText = prefill;
  }
}
function checkForHashtag() {
  const hashtag = getQueryVariable('hashtag')

  const list_title_element = document.getElementById('list_title')
  if (hashtag) {
    list_title_element.innerHTML = `Latest Links for #${hashtag}`
  } else {
    list_title_element.innerHTML = `Latest Links`
  }
}
function checkForInviteInUrl() {
  const url = new URL(window.location.href); // 'http://localhost:4008/invite/:uuid'
  
  if (url.pathname.startsWith('/invite/')) {
    const invite = url.pathname.split('/')[2] // get the uuid from the invite

    if (invite.length > 0) {
      document.getElementById('has_invite').classList.remove('hidden');
      document.getElementById('no_invite').classList.add('hidden');
    } else {
      document.getElementById('has_invite').classList.add('hidden');
      document.getElementById('no_invite').classList.remove('hidden');
    }
  } else {
    document.getElementById('has_invite').classList.add('hidden');
    document.getElementById('no_invite').classList.remove('hidden');
  }

}

function login() {
  // goto /login and have the current url as redirect_to in the query
  window.location.href = `/login?redirect_to=${encodeURIComponent(window.location.href)}`
}
function logout() {
  // goto /logout and have the current url as redirect_to in the query
  window.location.href = `/logout?redirect_to=${encodeURIComponent(window.location.href)}`
}

window.addEventListener('popstate', () => {
  checkForPrefill()
  checkForHashtag()
  checkForInviteInUrl()
})
checkForPrefill()
checkForHashtag()
checkForInviteInUrl()

getPosts()
getInvites()
checkIfLoggedIn()
initShareButtonListener()
