export function getTwitchScraper(chatId: string, chatName: string): string {
  const serializedChatId = JSON.stringify(chatId);
  const serializedChatName = JSON.stringify(chatName);
  return `
(function() {
  if (window.__streamchat_init) return true;
  window.__streamchat_init = true;

  var chatId = ${serializedChatId};
  var chatName = ${serializedChatName};
  var processed = new WeakSet();
  var sequence = 0;

  function processElement(el) {
    var userEl = el.querySelector
      ? el.querySelector('[class*="chat-author__display-name"], .chat-author__display-name, [data-a-target="chat-message-username"]')
      : null;
    var msgEl = el.querySelector
      ? el.querySelector('[class*="text-fragment"], .text-fragment, [data-a-target="chat-message-text"]')
      : null;

    var userName, message;

    if (userEl && msgEl) {
      userName = userEl.textContent.trim();
      message = msgEl.textContent.trim();
    } else {
      var allText = el.textContent ? el.textContent.trim() : '';
      if (allText.length < 3) return null;
      var parts = allText.split(':');
      if (parts.length < 2) return null;
      userName = parts[0].trim();
      message = parts.slice(1).join(':').trim();
    }

    if (!userName || !message) return null;

    if (processed.has(el)) return null;
    processed.add(el);
    var elementId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-message-id'));
    var id = chatId + '_tw_' + (elementId || (Date.now().toString(36) + '_' + (++sequence)));
    var avatarEl = el.querySelector ? el.querySelector('img[alt*="avatar"], img[class*="avatar"]') : null;

    return {
      messageId: id,
      platform: 'twitch',
      chatId: chatId,
      chatName: chatName,
      userName: userName,
      userAvatar: avatarEl ? (avatarEl.src || avatarEl.getAttribute('src')) : null,
      message: message,
      timestamp: Date.now()
    };
  }

  function sendMessages(msgs) {
    var valid = msgs.filter(Boolean);
    if (valid.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chat_messages', messages: valid }));
    }
  }

  function initialScan() {
    var items = document.querySelectorAll('[class*="chat-line__message"], .chat-line__message, [data-a-target="chat-line-message"]');
    if (!items.length) items = document.querySelectorAll('[class*="ChatLine"]');
    var msgs = [];
    items.forEach(function(el) { msgs.push(processElement(el)); });
    sendMessages(msgs);
  }

  function setupObserver() {
    var container = document.querySelector('[class*="chat-scrollable-area"], .chat-scrollable-area__message-container, [role="log"]');
    if (!container) return false;

    var observer = new MutationObserver(function(mutations) {
      var msgs = [];
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          msgs.push(processElement(node));
        });
      });
      sendMessages(msgs);
    });
    observer.observe(container, { childList: true, subtree: false });
    return true;
  }

  initialScan();
  if (!setupObserver()) {
    var retries = 0;
    var interval = setInterval(function() {
      if (setupObserver() || ++retries > 10) clearInterval(interval);
    }, 1000);
  }
})();
true;
`;
}

export function getYouTubeScraper(chatId: string, chatName: string): string {
  const serializedChatId = JSON.stringify(chatId);
  const serializedChatName = JSON.stringify(chatName);
  return `
(function() {
  if (window.__streamchat_init) return true;
  window.__streamchat_init = true;

  var chatId = ${serializedChatId};
  var chatName = ${serializedChatName};
  var processed = new WeakSet();
  var sequence = 0;

  function processElement(el) {
    var userEl = el.querySelector ? el.querySelector('#author-name') : null;
    var msgEl = el.querySelector ? el.querySelector('#message') : null;
    if (!userEl || !msgEl) return null;

    var userName = userEl.textContent.trim();
    var message = msgEl.textContent.trim();
    if (!userName || !message) return null;

    if (processed.has(el)) return null;
    processed.add(el);
    var elementId = el.getAttribute && el.getAttribute('id');
    var id = chatId + '_yt_' + (elementId || (Date.now().toString(36) + '_' + (++sequence)));
    var avatarEl = el.querySelector ? el.querySelector('#author-photo img') : null;

    return {
      messageId: id,
      platform: 'youtube',
      chatId: chatId,
      chatName: chatName,
      userName: userName,
      userAvatar: avatarEl ? (avatarEl.src || avatarEl.getAttribute('src')) : null,
      message: message,
      timestamp: Date.now()
    };
  }

  function sendMessages(msgs) {
    var valid = msgs.filter(Boolean);
    if (valid.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chat_messages', messages: valid }));
    }
  }

  function initialScan() {
    var items = document.querySelectorAll('yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer');
    var msgs = [];
    items.forEach(function(el) { msgs.push(processElement(el)); });
    sendMessages(msgs);
  }

  function setupObserver() {
    var container = document.querySelector('yt-live-chat-item-list-renderer #items, #chat-messages #items, #items');
    if (!container) return false;

    var observer = new MutationObserver(function(mutations) {
      var msgs = [];
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          msgs.push(processElement(node));
        });
      });
      sendMessages(msgs);
    });
    observer.observe(container, { childList: true, subtree: false });
    return true;
  }

  initialScan();
  if (!setupObserver()) {
    var retries = 0;
    var interval = setInterval(function() {
      if (setupObserver() || ++retries > 10) clearInterval(interval);
    }, 1000);
  }
})();
true;
`;
}

export function getKickScraper(chatId: string, chatName: string): string {
  const serializedChatId = JSON.stringify(chatId);
  const serializedChatName = JSON.stringify(chatName);
  return `
(function() {
  if (window.__streamchat_init) return true;
  window.__streamchat_init = true;

  var chatId = ${serializedChatId};
  var chatName = ${serializedChatName};
  var processed = new WeakSet();
  var sequence = 0;

  function processElement(el) {
    var userEl = el.querySelector
      ? el.querySelector('[class*="chat-entry-username"], .chat-entry-username, [class*="username"]')
      : null;
    var msgEl = el.querySelector
      ? el.querySelector('[class*="chat-entry-content"], .chat-entry-content, [class*="message-content"]')
      : null;

    var userName, message;

    if (userEl && msgEl) {
      userName = userEl.textContent.trim();
      message = msgEl.textContent.trim();
    } else {
      var allText = el.textContent ? el.textContent.trim() : '';
      if (allText.length < 3 || !allText.includes(':')) return null;
      var parts = allText.split(':');
      userName = parts[0].trim();
      message = parts.slice(1).join(':').trim();
    }

    if (!userName || !message) return null;

    if (processed.has(el)) return null;
    processed.add(el);
    var elementId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-message-id'));
    var id = chatId + '_kk_' + (elementId || (Date.now().toString(36) + '_' + (++sequence)));
    var avatarEl = el.querySelector ? el.querySelector('img[alt*="avatar"], img[class*="avatar"]') : null;

    return {
      messageId: id,
      platform: 'kick',
      chatId: chatId,
      chatName: chatName,
      userName: userName,
      userAvatar: avatarEl ? (avatarEl.src || avatarEl.getAttribute('src')) : null,
      message: message,
      timestamp: Date.now()
    };
  }

  function sendMessages(msgs) {
    var valid = msgs.filter(Boolean);
    if (valid.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chat_messages', messages: valid }));
    }
  }

  function initialScan() {
    var items = document.querySelectorAll('[class*="chat-entry"], .chat-entry, [data-chat-entry]');
    if (!items.length) items = document.querySelectorAll('.message-container, [class*="message"]');
    var msgs = [];
    items.forEach(function(el) { msgs.push(processElement(el)); });
    sendMessages(msgs);
  }

  function setupObserver() {
    var container = document.querySelector('[id*="chatroom"], .chatroom, [class*="chat-list"]');
    if (!container) return false;

    var observer = new MutationObserver(function(mutations) {
      var msgs = [];
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          msgs.push(processElement(node));
        });
      });
      sendMessages(msgs);
    });
    observer.observe(container, { childList: true, subtree: false });
    return true;
  }

  initialScan();
  if (!setupObserver()) {
    var retries = 0;
    var interval = setInterval(function() {
      if (setupObserver() || ++retries > 10) clearInterval(interval);
    }, 1000);
  }
})();
true;
`;
}

export function getGenericScraper(chatId: string, chatName: string, platform: string): string {
  const serializedChatId = JSON.stringify(chatId);
  const serializedChatName = JSON.stringify(chatName);
  const serializedPlatform = JSON.stringify(platform);
  return `
(function() {
  if (window.__streamchat_init) return true;
  window.__streamchat_init = true;

  var chatId = ${serializedChatId};
  var chatName = ${serializedChatName};
  var platform = ${serializedPlatform};
  var processed = new WeakSet();
  var sequence = 0;

  function processElement(el) {
    if (!el.querySelector) return null;
    if (el.children && el.children.length > 10) return null;
    var text = el.textContent ? el.textContent.trim() : '';
    if (text.length < 3 || text.length > 500) return null;

    var parts = text.split(':');
    var userName = parts.length >= 2 ? parts[0].trim().substring(0, 30) : 'User';
    var message = parts.length >= 2 ? parts.slice(1).join(':').trim() : text;
    if (!message) return null;

    if (processed.has(el)) return null;
    processed.add(el);
    var elementId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-message-id'));
    var id = chatId + '_gen_' + (elementId || (Date.now().toString(36) + '_' + (++sequence)));

    return {
      messageId: id,
      platform: platform,
      chatId: chatId,
      chatName: chatName,
      userName: userName,
      userAvatar: null,
      message: message,
      timestamp: Date.now()
    };
  }

  function sendMessages(msgs) {
    var valid = msgs.filter(Boolean);
    if (valid.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chat_messages', messages: valid }));
    }
  }

  function initialScan() {
    var candidates = document.querySelectorAll('[class*="message"], [class*="chat"], [class*="comment"]');
    var msgs = [];
    candidates.forEach(function(el) { msgs.push(processElement(el)); });
    sendMessages(msgs);
  }

  function setupObserver() {
    var body = document.body;
    if (!body) return false;

    var observer = new MutationObserver(function(mutations) {
      var msgs = [];
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          msgs.push(processElement(node));
        });
      });
      sendMessages(msgs);
    });
    observer.observe(body, { childList: true, subtree: true });
    return true;
  }

  setTimeout(initialScan, 2000);
  setupObserver();
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
