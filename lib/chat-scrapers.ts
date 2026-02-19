export function getTwitchScraper(chatId: string, chatName: string): string {
  return `
(function() {
  if (window.__streamchat_observer) return true;
  window.__streamchat_observer = true;

  var lastSent = new Set();

  function scrapeMessages() {
    var items = document.querySelectorAll('[class*="chat-line__message"], .chat-line__message, [data-a-target="chat-line-message"]');
    if (!items.length) {
      items = document.querySelectorAll('.text-fragment, [class*="ChatLine"]');
    }

    var messages = [];
    items.forEach(function(el) {
      var userEl = el.querySelector('[class*="chat-author__display-name"], .chat-author__display-name, [data-a-target="chat-message-username"]');
      var msgEl = el.querySelector('[class*="text-fragment"], .text-fragment, [data-a-target="chat-message-text"]');

      if (!userEl || !msgEl) {
        var allText = el.textContent || '';
        if (allText.length > 2) {
          var parts = allText.split(':');
          if (parts.length >= 2) {
            var user = parts[0].trim();
            var msg = parts.slice(1).join(':').trim();
            if (user && msg) {
              var id = '${chatId}_tw_' + user + '_' + msg.substring(0, 30) + '_' + Date.now();
              if (!lastSent.has(id)) {
                lastSent.add(id);
                messages.push({
                  messageId: id,
                  platform: 'twitch',
                  chatId: '${chatId}',
                  chatName: '${chatName}',
                  userName: user,
                  userAvatar: null,
                  message: msg,
                  timestamp: Date.now()
                });
              }
            }
          }
        }
        return;
      }

      var userName = userEl.textContent.trim();
      var message = msgEl.textContent.trim();
      if (!userName || !message) return;

      var id = '${chatId}_tw_' + userName + '_' + message.substring(0, 30);
      if (lastSent.has(id)) return;
      lastSent.add(id);

      var avatarEl = el.querySelector('img[class*="chat-badge"], img');
      var avatar = avatarEl ? avatarEl.src : null;

      messages.push({
        messageId: id + '_' + Date.now(),
        platform: 'twitch',
        chatId: '${chatId}',
        chatName: '${chatName}',
        userName: userName,
        userAvatar: avatar,
        message: message,
        timestamp: Date.now()
      });
    });

    if (messages.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chat_messages', messages: messages }));
    }

    if (lastSent.size > 1000) {
      var arr = Array.from(lastSent);
      lastSent = new Set(arr.slice(arr.length - 500));
    }
  }

  var chatContainer = document.querySelector('[class*="chat-scrollable-area"], .chat-scrollable-area__message-container, [role="log"]');
  if (chatContainer) {
    var observer = new MutationObserver(function() {
      scrapeMessages();
    });
    observer.observe(chatContainer, { childList: true, subtree: true });
  }

  setInterval(scrapeMessages, 2000);
  scrapeMessages();
})();
true;
`;
}

export function getYouTubeScraper(chatId: string, chatName: string): string {
  return `
(function() {
  if (window.__streamchat_observer) return true;
  window.__streamchat_observer = true;

  var lastSent = new Set();

  function scrapeMessages() {
    var items = document.querySelectorAll('yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer');
    var messages = [];

    items.forEach(function(el) {
      var userEl = el.querySelector('#author-name');
      var msgEl = el.querySelector('#message');

      if (!userEl || !msgEl) return;

      var userName = userEl.textContent.trim();
      var message = msgEl.textContent.trim();
      if (!userName || !message) return;

      var id = '${chatId}_yt_' + userName + '_' + message.substring(0, 30);
      if (lastSent.has(id)) return;
      lastSent.add(id);

      var avatarEl = el.querySelector('#img');
      var avatar = avatarEl ? avatarEl.src : null;

      messages.push({
        messageId: id + '_' + Date.now(),
        platform: 'youtube',
        chatId: '${chatId}',
        chatName: '${chatName}',
        userName: userName,
        userAvatar: avatar,
        message: message,
        timestamp: Date.now()
      });
    });

    if (messages.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chat_messages', messages: messages }));
    }

    if (lastSent.size > 1000) {
      var arr = Array.from(lastSent);
      lastSent = new Set(arr.slice(arr.length - 500));
    }
  }

  var chatContainer = document.querySelector('#chat-messages, #items, yt-live-chat-item-list-renderer #items');
  if (chatContainer) {
    var observer = new MutationObserver(function() {
      scrapeMessages();
    });
    observer.observe(chatContainer, { childList: true, subtree: true });
  }

  setInterval(scrapeMessages, 2000);
  scrapeMessages();
})();
true;
`;
}

export function getKickScraper(chatId: string, chatName: string): string {
  return `
(function() {
  if (window.__streamchat_observer) return true;
  window.__streamchat_observer = true;

  var lastSent = new Set();

  function scrapeMessages() {
    var items = document.querySelectorAll('[class*="chat-entry"], .chat-entry, [data-chat-entry]');
    if (!items.length) {
      items = document.querySelectorAll('.message-container, [class*="message"]');
    }

    var messages = [];
    items.forEach(function(el) {
      var userEl = el.querySelector('[class*="chat-entry-username"], .chat-entry-username, [class*="username"]');
      var msgEl = el.querySelector('[class*="chat-entry-content"], .chat-entry-content, [class*="message-content"]');

      if (!userEl || !msgEl) {
        var allText = el.textContent || '';
        if (allText.length > 2 && allText.includes(':')) {
          var parts = allText.split(':');
          var user = parts[0].trim();
          var msg = parts.slice(1).join(':').trim();
          if (user && msg) {
            var id = '${chatId}_kk_' + user + '_' + msg.substring(0, 30);
            if (!lastSent.has(id)) {
              lastSent.add(id);
              messages.push({
                messageId: id + '_' + Date.now(),
                platform: 'kick',
                chatId: '${chatId}',
                chatName: '${chatName}',
                userName: user,
                userAvatar: null,
                message: msg,
                timestamp: Date.now()
              });
            }
          }
        }
        return;
      }

      var userName = userEl.textContent.trim();
      var message = msgEl.textContent.trim();
      if (!userName || !message) return;

      var id = '${chatId}_kk_' + userName + '_' + message.substring(0, 30);
      if (lastSent.has(id)) return;
      lastSent.add(id);

      var avatarEl = el.querySelector('img');
      var avatar = avatarEl ? avatarEl.src : null;

      messages.push({
        messageId: id + '_' + Date.now(),
        platform: 'kick',
        chatId: '${chatId}',
        chatName: '${chatName}',
        userName: userName,
        userAvatar: avatar,
        message: message,
        timestamp: Date.now()
      });
    });

    if (messages.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chat_messages', messages: messages }));
    }

    if (lastSent.size > 1000) {
      var arr = Array.from(lastSent);
      lastSent = new Set(arr.slice(arr.length - 500));
    }
  }

  var chatContainer = document.querySelector('[id*="chatroom"], .chatroom, [class*="chat-list"]');
  if (chatContainer) {
    var observer = new MutationObserver(function() {
      scrapeMessages();
    });
    observer.observe(chatContainer, { childList: true, subtree: true });
  }

  setInterval(scrapeMessages, 2000);
  scrapeMessages();
})();
true;
`;
}

export function getGenericScraper(chatId: string, chatName: string, platform: string): string {
  return `
(function() {
  if (window.__streamchat_observer) return true;
  window.__streamchat_observer = true;

  var lastSent = new Set();
  var msgCount = 0;

  function scrapeMessages() {
    var candidates = document.querySelectorAll('[class*="message"], [class*="chat"], [class*="comment"]');
    var messages = [];

    candidates.forEach(function(el) {
      if (el.children.length > 10) return;
      var text = el.textContent.trim();
      if (text.length < 3 || text.length > 500) return;

      var id = '${chatId}_gen_' + text.substring(0, 50);
      if (lastSent.has(id)) return;
      lastSent.add(id);

      var parts = text.split(':');
      var userName = parts.length >= 2 ? parts[0].trim() : 'User';
      var message = parts.length >= 2 ? parts.slice(1).join(':').trim() : text;

      if (!message) return;

      messages.push({
        messageId: id + '_' + (++msgCount),
        platform: '${platform}',
        chatId: '${chatId}',
        chatName: '${chatName}',
        userName: userName.substring(0, 30),
        userAvatar: null,
        message: message,
        timestamp: Date.now()
      });
    });

    if (messages.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chat_messages', messages: messages }));
    }

    if (lastSent.size > 1000) {
      var arr = Array.from(lastSent);
      lastSent = new Set(arr.slice(arr.length - 500));
    }
  }

  var body = document.body;
  if (body) {
    var observer = new MutationObserver(function() {
      scrapeMessages();
    });
    observer.observe(body, { childList: true, subtree: true });
  }

  setInterval(scrapeMessages, 3000);
  setTimeout(scrapeMessages, 2000);
})();
true;
`;
}

export function getScraperForPlatform(platform: string, chatId: string, chatName: string): string {
  switch (platform) {
    case "twitch":
      return getTwitchScraper(chatId, chatName);
    case "youtube":
      return getYouTubeScraper(chatId, chatName);
    case "kick":
      return getKickScraper(chatId, chatName);
    default:
      return getGenericScraper(chatId, chatName, platform);
  }
}
