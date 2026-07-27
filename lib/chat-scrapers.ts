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
  var rowSelector = [
    '[class*="chat-line__message"]',
    '.chat-line__message',
    '[data-a-target="chat-line-message"]',
    '[class*="ChatLine"]'
  ].join(',');

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

  function collectFrom(root) {
    if (!root || root.nodeType !== 1) return [];
    var items = [];
    if (root.matches && root.matches(rowSelector)) items.push(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(rowSelector).forEach(function(item) { items.push(item); });
    }
    var msgs = [];
    items.forEach(function(el) { msgs.push(processElement(el)); });
    return msgs;
  }

  function scanDocument() {
    if (document.body) sendMessages(collectFrom(document.body));
  }

  function setupObserver() {
    if (!document.body) return false;
    var observer = new MutationObserver(function(mutations) {
      var msgs = [];
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          collectFrom(node).forEach(function(message) { msgs.push(message); });
        });
      });
      sendMessages(msgs);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return true;
  }

  function start() {
    scanDocument();
    setupObserver();
    setInterval(scanDocument, 3000);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
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
  var rowSelector = [
    'yt-live-chat-text-message-renderer',
    'yt-live-chat-paid-message-renderer',
    'yt-live-chat-paid-sticker-renderer',
    'yt-live-chat-membership-item-renderer',
    'yt-live-chat-sponsorships-gift-purchase-announcement-renderer',
    'yt-live-chat-sponsorships-gift-redemption-announcement-renderer',
    'yt-live-chat-viewer-engagement-message-renderer'
  ].join(',');

  function processElement(el) {
    var userEl = el.querySelector ? el.querySelector('#author-name') : null;
    var messageSelectors = [
      '#message',
      '#header-subtext',
      '#primary-text',
      '#detail-text',
      '#purchase-amount',
      '#purchase-amount-chip'
    ].join(',');
    var messageNodes = el.querySelectorAll
      ? Array.prototype.slice.call(el.querySelectorAll(messageSelectors))
      : [];
    var messageParts = [];
    messageNodes.forEach(function(node) {
      var value = node.textContent ? node.textContent.trim() : '';
      if (value && messageParts.indexOf(value) === -1) messageParts.push(value);
    });
    var sticker = el.querySelector
      ? el.querySelector('#sticker img, img[alt*="sticker" i]')
      : null;
    if (sticker && sticker.alt && messageParts.indexOf(sticker.alt) === -1) {
      messageParts.push(sticker.alt);
    }

    var userName = userEl && userEl.textContent
      ? userEl.textContent.trim()
      : 'YouTube';
    var message = messageParts.join(' · ').trim();
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

  function collectFrom(root) {
    if (!root || root.nodeType !== 1) return [];
    var items = [];
    if (root.matches && root.matches(rowSelector)) items.push(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(rowSelector).forEach(function(item) { items.push(item); });
    }
    var msgs = [];
    items.forEach(function(el) { msgs.push(processElement(el)); });
    return msgs;
  }

  function scanDocument() {
    if (document.body) sendMessages(collectFrom(document.body));
  }

  function setupObserver() {
    if (!document.body) return false;
    var observer = new MutationObserver(function(mutations) {
      var msgs = [];
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          collectFrom(node).forEach(function(message) { msgs.push(message); });
        });
      });
      sendMessages(msgs);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return true;
  }

  function start() {
    scanDocument();
    setupObserver();
    setInterval(scanDocument, 3000);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
true;
`;
}

export function getKickScraper(chatId: string, chatName: string): string {
  const serializedChatId = JSON.stringify(chatId);
  const serializedChatName = JSON.stringify(chatName);
  return `
(function() {
  if (window.__streamchat_kick_dom_init) return true;
  window.__streamchat_kick_dom_init = true;

  var chatId = ${serializedChatId};
  var chatName = ${serializedChatName};
  var processed = new WeakSet();
  var sequence = 0;
  var rowSelector = [
    '[data-chat-entry]',
    '[data-message-id]',
    '[data-testid="chat-message"]',
    '[data-testid*="chat-entry"]',
    '[class*="chat-entry"]',
    '[class*="chat-message"]',
    '.message-container'
  ].join(',');
  var userSelector = [
    '[data-chat-username]',
    '[data-testid*="username"]',
    '[class*="chat-entry-username"]',
    '.chat-entry-username',
    '[class*="username"]'
  ].join(',');
  var contentSelector = [
    '[data-chat-message]',
    '[data-testid*="message-content"]',
    '[class*="chat-entry-content"]',
    '.chat-entry-content',
    '[class*="message-content"]'
  ].join(',');

  function processElement(el) {
    if (!el || !el.querySelector || processed.has(el)) return null;
    if (window.__streamchat_kick_socket_message_received) return null;

    var userEl = el.querySelector(userSelector);
    var msgEl = el.querySelector(contentSelector);

    var userName, message;

    if (userEl && msgEl) {
      userName = userEl.textContent.trim();
      message = msgEl.textContent.trim();
    } else {
      var allText = el.textContent ? el.textContent.trim() : '';
      if (allText.length < 3 || allText.length > 1000 || !allText.includes(':')) return null;
      var parts = allText.split(':');
      userName = parts[0].trim();
      message = parts.slice(1).join(':').trim();
    }

    if (!userName || !message || userName.length > 80) return null;

    processed.add(el);
    var elementId = el.getAttribute && (
      el.getAttribute('data-id') ||
      el.getAttribute('data-message-id') ||
      el.id
    );
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

  function collectFrom(root) {
    if (!root || root.nodeType !== 1) return [];
    var items = [];
    if (root.matches && root.matches(rowSelector)) items.push(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(rowSelector).forEach(function(item) { items.push(item); });
    }
    var msgs = [];
    items.forEach(function(el) { msgs.push(processElement(el)); });
    return msgs;
  }

  function scanDocument() {
    if (!document.body) return;
    sendMessages(collectFrom(document.body));
  }

  function setupObserver() {
    if (!document.body) return false;
    var observer = new MutationObserver(function(mutations) {
      var msgs = [];
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          collectFrom(node).forEach(function(message) { msgs.push(message); });
        });
      });
      sendMessages(msgs);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return true;
  }

  function start() {
    scanDocument();
    setupObserver();
    setInterval(scanDocument, 3000);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
true;
`;
}

export function getKickSocketInterceptor(chatId: string, chatName: string): string {
  const serializedChatId = JSON.stringify(chatId);
  const serializedChatName = JSON.stringify(chatName);
  return `
(function() {
  if (window.__streamchat_kick_socket_init || !window.WebSocket) return true;
  window.__streamchat_kick_socket_init = true;

  var chatId = ${serializedChatId};
  var chatName = ${serializedChatName};
  var NativeWebSocket = window.WebSocket;

  function parseJson(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function forward(raw) {
    var envelope = parseJson(raw);
    if (!envelope || typeof envelope !== 'object') return;
    var eventName = String(envelope.event || envelope.type || '');
    if (!/ChatMessage(?:Sent)?Event|chat\.message\.sent/i.test(eventName)) return;

    var payload = parseJson(envelope.data) || envelope.data || envelope;
    if (payload && payload.message) payload = payload.message;
    if (!payload || typeof payload !== 'object') return;

    var content = String(payload.content || '').trim();
    var sender = payload.sender || payload.user || {};
    var userName = String(sender.username || sender.name || '').trim();
    if (!content || !userName) return;

    var rawId = payload.id || payload.message_id || (Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
    var timestamp = payload.created_at ? new Date(payload.created_at).getTime() : Date.now();
    if (!Number.isFinite(timestamp)) timestamp = Date.now();

    window.__streamchat_kick_socket_message_received = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'chat_messages',
      messages: [{
        messageId: chatId + '_kk_' + rawId,
        platform: 'kick',
        chatId: chatId,
        chatName: chatName,
        userName: userName,
        userAvatar: sender.profile_picture || sender.profile_pic || null,
        message: content,
        timestamp: timestamp
      }]
    }));
  }

  function StreamChatWebSocket(url, protocols) {
    var socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    socket.addEventListener('message', function(event) { forward(event.data); });
    return socket;
  }

  StreamChatWebSocket.prototype = NativeWebSocket.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function(key) {
    try { Object.defineProperty(StreamChatWebSocket, key, { value: NativeWebSocket[key] }); } catch (_) {}
  });
  window.WebSocket = StreamChatWebSocket;
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
  var rowSelector = platform === 'facebook'
    ? [
        '[data-testid*="comment"]',
        '[aria-label*="comment" i]',
        '[aria-label*="coment" i]',
        '[role="article"]'
      ].join(',')
    : platform === 'tiktok'
      ? [
          '[data-e2e="comment-item"]',
          '[data-e2e*="comment-level"]',
          '[class*="CommentItemContainer"]',
          '[class*="DivCommentItem"]'
        ].join(',')
      : '[data-message-id], [class*="message"], [class*="comment"]';
  var userSelector = [
    '[data-e2e="comment-username-1"]',
    '[data-e2e*="comment-username"]',
    '[class*="username"]',
    '[class*="UserName"]',
    'a[role="link"] strong',
    'strong'
  ].join(',');
  var messageSelector = [
    '[data-e2e="comment-level-1"]',
    '[data-e2e*="comment-text"]',
    '[class*="comment-text"]',
    '[class*="CommentText"]',
    '[data-message-text]'
  ].join(',');

  function processElement(el) {
    if (!el.querySelector) return null;
    if (el.children && el.children.length > 10) return null;
    var text = el.textContent ? el.textContent.trim() : '';
    if (text.length < 3 || text.length > 500) return null;

    var userEl = el.querySelector(userSelector);
    var messageEl = el.querySelector(messageSelector);
    var userName = userEl && userEl.textContent
      ? userEl.textContent.trim().substring(0, 80)
      : '';
    var message = messageEl && messageEl.textContent
      ? messageEl.textContent.trim()
      : '';

    if (!userName || !message || userName === message) {
      var separator = text.indexOf(':');
      if (separator < 1) return null;
      userName = text.slice(0, separator).trim().substring(0, 80);
      message = text.slice(separator + 1).trim();
    }
    if (!userName || !message) return null;

    if (processed.has(el)) return null;
    processed.add(el);
    var elementId = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-message-id'));
    var id = chatId + '_gen_' + (elementId || (Date.now().toString(36) + '_' + (++sequence)));

    var avatarEl = el.querySelector
      ? el.querySelector('img[alt*="avatar" i], img[class*="avatar" i]')
      : null;

    return {
      messageId: id,
      platform: platform,
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

  function collectFrom(root) {
    if (!root || root.nodeType !== 1) return [];
    var candidates = [];
    if (root.matches && root.matches(rowSelector)) candidates.push(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(rowSelector).forEach(function(item) { candidates.push(item); });
    }
    var msgs = [];
    candidates.forEach(function(el) { msgs.push(processElement(el)); });
    return msgs;
  }

  function scanDocument() {
    if (document.body) sendMessages(collectFrom(document.body));
  }

  function setupObserver() {
    var body = document.body;
    if (!body) return false;

    var observer = new MutationObserver(function(mutations) {
      var msgs = [];
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          collectFrom(node).forEach(function(message) { msgs.push(message); });
        });
      });
      sendMessages(msgs);
    });
    observer.observe(body, { childList: true, subtree: true });
    return true;
  }

  function start() {
    scanDocument();
    setupObserver();
    setInterval(scanDocument, 3000);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
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
