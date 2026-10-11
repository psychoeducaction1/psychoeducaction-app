/*
 * Suivi anonyme des formulaires de contact WPForms et des liens telephoniques.
 * A installer dans WPCode apres le deploiement de /api/public/acquisition-events.
 * Aucun champ de formulaire n'est lu ou transmis.
 */
(function () {
  var API = 'https://app.psychoeducaction.com/api/public/acquisition-events';
  var CONTACT_FORM_IDS = ['598', '1009', '2527'];
  var ATTRIBUTION_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'gclid',
    'gbraid',
    'wbraid',
    'fbclid'
  ];

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'pea-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function rememberAttribution() {
    var query = new URLSearchParams(window.location.search);
    var stored = {};
    try {
      stored = JSON.parse(window.localStorage.getItem('pea.acquisition') || '{}');
    } catch {}

    ATTRIBUTION_KEYS.forEach(function (key) {
      var value = query.get(key);
      if (value) stored[key] = value.slice(0, 120);
    });

    try {
      window.localStorage.setItem('pea.acquisition', JSON.stringify(stored));
    } catch {}
    return stored;
  }

  function attribution() {
    var raw = rememberAttribution();
    var result = {};
    ['source', 'medium', 'campaign', 'term', 'content', 'id'].forEach(function (key) {
      if (raw['utm_' + key]) result[key] = raw['utm_' + key];
    });
    ['gclid', 'gbraid', 'wbraid', 'fbclid'].forEach(function (key) {
      if (raw[key]) result[key] = raw[key];
    });
    return result;
  }

  function record(eventType, idempotencyKey) {
    return fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        eventType: eventType,
        source: 'Site web',
        utm: attribution()
      })
    }).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok) throw new Error(result.error || 'Tracking impossible.');
        return result;
      });
    });
  }

  function pushOnce(eventName, conversionEventId) {
    if (!conversionEventId) return;
    var storageKey = 'pea.' + eventName + '.' + conversionEventId;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, '1');
    } catch {}
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: eventName,
      conversion_event_id: conversionEventId
    });
  }

  rememberAttribution();

  if (window.jQuery) window.jQuery(document).on('wpformsAjaxSubmitSuccess', function (_event, data) {
    var formId = String(
      (data && data.data && (data.data.form_id || data.data.formId)) ||
      (data && (data.form_id || data.formId)) ||
      ''
    );
    if (CONTACT_FORM_IDS.indexOf(formId) === -1) return;

    var attemptKey = 'pea.contact-attempt.' + formId;
    var idempotencyKey;
    try {
      idempotencyKey = window.sessionStorage.getItem(attemptKey) || uuid();
      window.sessionStorage.setItem(attemptKey, idempotencyKey);
    } catch {
      idempotencyKey = uuid();
    }

    record('contact_form_submitted', idempotencyKey)
      .then(function (result) {
        pushOnce('contact_form_submitted', result.conversionEventId);
        try { window.sessionStorage.removeItem(attemptKey); } catch {}
      })
      .catch(function () {});
  });

  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href^="tel:"]');
    if (!link) return;
    var phoneKey = 'pea.phone-click.' + window.location.pathname + '.' + link.getAttribute('href');
    var idempotencyKey;
    try {
      idempotencyKey = window.sessionStorage.getItem(phoneKey) || uuid();
      window.sessionStorage.setItem(phoneKey, idempotencyKey);
    } catch {
      idempotencyKey = uuid();
    }
    record('phone_click', idempotencyKey)
      .then(function (result) { pushOnce('phone_click', result.conversionEventId); })
      .catch(function () {});
  }, true);
})();
