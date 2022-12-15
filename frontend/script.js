
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
            .replace(url_regex, match => {
              // todo make sure that this does not break out of the s-tag by stripping possible html tags
              return `<a class="url" href="${match}" target="_blank">${match}</a>`
            })
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

      document.getElementById('list_section').innerHTML = `
          ${latest.map(item => `
            <div class="shared_item">
              <p class="text">${item.text}</p>
              <em class="body2">${item.date}</em>
            </div>
          `).join('')}
        `;
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
    list_title_element.innerHTML = `Latest 10 Links for #${hashtag}`
  } else {
    list_title_element.innerHTML = `Latest 10 Links`
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
