
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

function getLatest() {

  let url = '/api/latest'

  const hashtag = getQueryVariable('hashtag')
  if (hashtag) {
    url = `/api/latest_with_hashtag/${hashtag}`
  }

  fetch(url)
    .then(response => response.json())
    .then(data => {

      const latest = data.posts
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map(item => {

          item.text = item.text
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
              const url_encoded = encodeURIComponent(url)

              return `<a class="url" href="${url_encoded}" target="_blank">${url}</a>`
            })
            // make hashtags clickable
            .replace(hashtag_regex, (match, p1) => {
              // todo make sure that this does not break out of the s-tag by stripping possible html tags
              return `<a class="hashtag" href="?hashtag=${p1}">${match}</a>`
            })

          // get the difference between now and the date in a human readable format
          const date = new Date(item.date)
          const diff = new Date() - date
          if (diff >= 0) {
            const diff_days = Math.floor(diff / (1000 * 60 * 60 * 24))
            const diff_hours = Math.floor(diff / (1000 * 60 * 60))
            const diff_minutes = Math.floor(diff / (1000 * 60))
            const diff_seconds = Math.floor(diff / (1000))

            if (diff_seconds < 60) {
              item.date = `${diff_seconds} ${diff_seconds === 1 ? 'second' : 'seconds'} ago`
            } else if (diff_minutes < 60) {
              item.date = `${diff_minutes} ${diff_minutes === 1 ? 'minute' : 'minutes'} ago`
            } else if (diff_hours < 24) {
              item.date = `${diff_hours} ${diff_hours === 1 ? 'hour' : 'hours'} ago`
            } else if (diff_days < 7) {
              item.date = `${diff_days} ${diff_days === 1 ? 'day' : 'days'} ago`
            } else {
              item.date = new Date(item.date).toLocaleString()
            }
          } else {
            item.date = `${new Date(item.date).toLocaleString()} – IN THE FUTURE`
          }

          return item
        })

      // todo add delete button via /api/delete/:uuid

      const list_section_element = document.querySelector('#list_section')
      list_section_element.innerHTML = ''

      for (const item of latest) {
        const new_item = document.createElement('div')
        new_item.classList.add('shared_item')

        const text_ele = document.createElement('p')
        text_ele.classList.add('text')
        text_ele.innerHTML = item.text
        new_item.appendChild(text_ele)

        const footer_ele = document.createElement('div')
        footer_ele.classList.add('footer')
        
        const date_ele = document.createElement('em')
        date_ele.classList.add('body2')
        date_ele.innerHTML = item.date
        footer_ele.appendChild(date_ele)

        if (item.permissions.can_delete === true) {
          const delete_button_ele = document.createElement('button')
          delete_button_ele.classList.add('red')
          delete_button_ele.innerHTML = 'Delete'
          delete_button_ele.addEventListener('click', () => {
            fetch(`/api/delete/${item.uuid}`, {
              method: 'DELETE'
            })
              .then(response => response.json())
              .then(data => {
                if (data.deleted === true) {
                  new_item.remove()
                } else {
                  console.error(data)
                  alert('Could not delete item')
                }
              })
          })
          footer_ele.appendChild(delete_button_ele)
        }

        new_item.appendChild(footer_ele)

        list_section_element.appendChild(new_item)
      }

    })
}

function checkIfLoggedIn() {
  fetch('/api/whoami')
    .then(response => response.json())
    .then(data => {
      if (data.email) {
        document.getElementById('login_wrapper').classList.add('hidden');
        document.getElementById('logout_wrapper').classList.remove('hidden');
        document.getElementById('user_email').innerHTML = `${data.email}`;
      } else {
        document.getElementById('login_wrapper').classList.remove('hidden');
        document.getElementById('logout_wrapper').classList.add('hidden');
        document.getElementById('user_email').innerHTML = '???@???.???';
      }

      if (data.blocked === true) {
        document.getElementById('share_wrapper').classList.add('hidden');
        document.getElementById('blocked_wrapper').classList.remove('hidden');
      } else {
        document.getElementById('share_wrapper').classList.remove('hidden');
        document.getElementById('blocked_wrapper').classList.add('hidden');
      }
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
          getLatest()
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

window.addEventListener('popstate', () => {
  checkForPrefill()
  checkForHashtag()
})
checkForPrefill()
checkForHashtag()

getLatest()
checkIfLoggedIn()
initShareButtonListener()
