/*
 * Attribution globale et confirmations anonymes des demandes publiques.
 * A installer dans WPCode apres le deploiement de /api/public/acquisition-events.
 * Aucun champ de formulaire n'est lu ou transmis.
 */
(function () {
  if (window.peaAcquisition) return;
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

  var ATTRIBUTION_STORAGE_KEY = 'pea.acquisition';
  var ATTRIBUTION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
  var currentAttribution = null;
  var emittedEvents = {};

  function marketingAllowed() {
    try {
      if (typeof window.cmplz_has_consent === 'function') return window.cmplz_has_consent('marketing') === true;
      // The global helper may run before the deferred Complianz script.
      // Only its existing explicit consent cookie permits cross-page storage.
      return /(?:^|;\s*)cmplz_marketing=allow(?:;|$)/.test(document.cookie || '');
    } catch { return false; }
  }

  function cleanAttribution(raw) {
    var clean = {};
    ATTRIBUTION_KEYS.forEach(function (key) {
      if (raw && typeof raw[key] === 'string') {
        var value = raw[key].replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
        if (value) clean[key] = value;
      }
    });
    return clean;
  }

  function rememberAttribution() {
    var query = new URLSearchParams(window.location.search);
    var incoming = {};
    ATTRIBUTION_KEYS.forEach(function (key) {
      var value = query.get(key);
      if (value) incoming[key] = value;
    });
    incoming = cleanAttribution(incoming);
    if (Object.keys(incoming).length) {
      // A new campaign replaces the previous touch: never mix Google and Meta IDs.
      currentAttribution = { capturedAt: Date.now(), parameters: incoming };
    }
    var allowed = marketingAllowed();
    if (!allowed) {
      try { window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY); } catch {}
      // Parameters already present on this page may accompany the business request.
      // Cross-page marketing storage is only used with consent.
      return incoming;
    }
    if (!currentAttribution) {
      try {
        var stored = JSON.parse(window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY) || 'null');
        if (stored && stored.version === 2 && typeof stored.capturedAt === 'number' &&
          stored.capturedAt <= Date.now() && Date.now() - stored.capturedAt < ATTRIBUTION_MAX_AGE) {
          currentAttribution = { capturedAt: stored.capturedAt, parameters: cleanAttribution(stored.parameters) };
        }
      } catch {}
    }
    if (currentAttribution && Date.now() - currentAttribution.capturedAt >= ATTRIBUTION_MAX_AGE) {
      currentAttribution = null;
    }
    try {
      if (currentAttribution) {
        window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify({
          version: 2,
          capturedAt: currentAttribution.capturedAt,
          parameters: currentAttribution.parameters
        }));
      } else window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
    } catch {}
    return currentAttribution ? currentAttribution.parameters : {};
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
    if (typeof conversionEventId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversionEventId)) return false;
    var storageKey = 'pea.' + eventName + '.' + conversionEventId;
    if (emittedEvents[storageKey]) return false;
    try {
      if (window.sessionStorage.getItem(storageKey)) return false;
    } catch {}
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: eventName,
      conversion_event_id: conversionEventId
    });
    emittedEvents[storageKey] = true;
    try { window.sessionStorage.setItem(storageKey, '1'); } catch {}
    return true;
  }

  window.peaAcquisition = {
    attribution: attribution,
    emitIntakeSuccess: function (result, contactType) {
      if (!result || result.success !== true) return false;
      var eventName = contactType === 'scheduled_call' ? 'booking_form_submitted' :
        contactType === 'rapid_callback' ? 'rapid_callback_submitted' : null;
      return eventName ? pushOnce(eventName, result.conversionEventId) : false;
    }
  };
  rememberAttribution();
  document.addEventListener('cmplz_status_change', rememberAttribution);
  document.addEventListener('cmplz_enable_category', rememberAttribution);
  document.addEventListener('cmplz_revoke', function () {
    currentAttribution = null;
    try { window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY); } catch {}
  });

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
